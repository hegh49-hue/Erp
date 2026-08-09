const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { postJournalEntry } = require('../services/accounting');
const { getAccountByCode, issueStock } = require('../services/inventory');

const router = express.Router();

// ---------- Cashiers are analytical elements under 1000 (cash box control account) ----------
router.get('/cashiers', asyncHandler(async (req, res) => {
  const cashAccount = await getAccountByCode(pool, '1000');
  const { rows } = await pool.query(
    'SELECT * FROM subledger_entities WHERE control_account_id = $1 AND is_active ORDER BY code',
    [cashAccount.id]
  );
  res.json(rows);
}));

router.post('/cashiers', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) throw new ApiError(400, 'اسم الكاشير مطلوب');
  const cashAccount = await getAccountByCode(pool, '1000');
  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS n FROM subledger_entities WHERE control_account_id = $1', [cashAccount.id]);
  const code = `CSH-${countRows[0].n + 1}`;
  const { rows } = await pool.query(
    `INSERT INTO subledger_entities (control_account_id, code, name) VALUES ($1,$2,$3) RETURNING *`,
    [cashAccount.id, code, name]
  );
  res.status(201).json(rows[0]);
}));

// ---------- ZATCA Phase-1 QR (TLV + Base64) ----------
function toTLV(tag, value) {
  const valBytes = Buffer.from(String(value), 'utf8');
  return Buffer.concat([Buffer.from([tag, valBytes.length]), valBytes]);
}
function buildZatcaQR(sellerName, vatNumber, isoTimestamp, total, vatAmount) {
  const buf = Buffer.concat([
    toTLV(1, sellerName || '-'),
    toTLV(2, vatNumber || '-'),
    toTLV(3, isoTimestamp),
    toTLV(4, total.toFixed(2)),
    toTLV(5, vatAmount.toFixed(2)),
  ]);
  return buf.toString('base64');
}

router.post('/checkout', asyncHandler(async (req, res) => {
  const { cashierId, warehouseId, orderType, orderSource, payMethod, payEntityId, payMethodLabel, items } = req.body;
  if (!cashierId) throw new ApiError(400, 'يرجى اختيار الكاشير');
  if (!warehouseId) throw new ApiError(400, 'يرجى اختيار المستودع');
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'السلة فارغة');

  const result = await withTransaction(async (client) => {
    const { rows: companyRows } = await client.query('SELECT * FROM companies ORDER BY created_at LIMIT 1');
    const company = companyRows[0];
    if (!company?.vat_number) throw new ApiError(400, 'يرجى إدخال الرقم الضريبي في الإعدادات أولاً');

    const itemIds = items.map((i) => i.itemId);
    const { rows: itemRows } = await client.query('SELECT * FROM items WHERE id = ANY($1::uuid[])', [itemIds]);
    const itemsById = new Map(itemRows.map((i) => [i.id, i]));

    let subtotal = 0, vat = 0, cogsTotal = 0;
    const lineDetails = [];
    for (const line of items) {
      const item = itemsById.get(line.itemId);
      if (!item) throw new ApiError(400, 'صنف غير موجود');
      const qty = Number(line.qty);
      if (!(qty > 0)) throw new ApiError(400, 'كمية غير صحيحة');
      const lineTotal = Number(item.price) * qty;
      let lineVat = 0;
      if (item.taxable) { lineVat = lineTotal - (lineTotal / 1.15); subtotal += lineTotal - lineVat; vat += lineVat; }
      else subtotal += lineTotal;

      let unitCost = 0;
      if (item.is_stock_tracked) {
        const stock = await issueStock(client, {
          itemId: item.id, warehouseId, qty, moveDate: new Date().toISOString().slice(0, 10),
          note: 'بيع نقاط البيع', refType: 'pos_sale', createdBy: req.user.id,
        });
        unitCost = stock.unitCost;
        cogsTotal += unitCost * qty;
      }
      lineDetails.push({ item, qty, unitPrice: item.price, taxable: item.taxable, unitCost });
    }
    const total = subtotal + vat;

    let payAccount, payEntity = payEntityId || null;
    if (payMethod === 'channel' && payEntityId) {
      payAccount = await getAccountByCode(client, '1150');
    } else {
      payAccount = await getAccountByCode(client, '1000');
      payEntity = cashierId;
    }
    const revenueAccount = await getAccountByCode(client, '4000');
    const vatAccount = await getAccountByCode(client, '2100');

    const revenueLines = [{ accountId: payAccount.id, debit: total, credit: 0, entityId: payEntity }];
    revenueLines.push({ accountId: revenueAccount.id, debit: 0, credit: subtotal });
    if (vat > 0) revenueLines.push({ accountId: vatAccount.id, debit: 0, credit: vat });

    const { rows: seqRows } = await client.query("SELECT nextval('pos_invoice_seq') AS n");
    const number = String(seqRows[0].n).padStart(6, '0');
    const now = new Date();
    const isoTs = now.toISOString();
    const qrBase64 = buildZatcaQR(company.name, company.vat_number, isoTs, total, vat);

    const revenueEntry = await postJournalEntry(client, {
      entryDate: isoTs.slice(0, 10),
      description: `مبيعات نقاط البيع - فاتورة #${number}`,
      reference: number,
      sourceType: 'pos_sale',
      createdBy: req.user.id,
      lines: revenueLines,
    });

    let cogsEntry = null;
    if (cogsTotal > 0) {
      const cogsAccount = await getAccountByCode(client, '5000');
      const invAccount = await getAccountByCode(client, '1200');
      cogsEntry = await postJournalEntry(client, {
        entryDate: isoTs.slice(0, 10),
        description: `تكلفة البضاعة المباعة - فاتورة #${number}`,
        reference: number,
        sourceType: 'pos_sale_cogs',
        createdBy: req.user.id,
        lines: [
          { accountId: cogsAccount.id, debit: cogsTotal, credit: 0 },
          { accountId: invAccount.id, debit: 0, credit: cogsTotal, entityId: warehouseId },
        ],
      });
    }

    const { rows: invRows } = await client.query(
      `INSERT INTO pos_invoices (number, issued_at, warehouse_id, cashier_id, order_type, order_source, pay_method_label,
         pay_account_id, pay_entity_id, subtotal, vat, total, cogs_total, qr_base64, journal_entry_id, cogs_entry_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [number, isoTs, warehouseId, cashierId, orderType || 'محلي', orderSource || 'محلي', payMethodLabel || payMethod,
        payAccount.id, payEntity, subtotal, vat, total, cogsTotal, qrBase64, revenueEntry.id, cogsEntry?.id || null, req.user.id]
    );
    const invoice = invRows[0];
    for (const d of lineDetails) {
      await client.query(
        `INSERT INTO pos_invoice_lines (invoice_id, item_id, qty, unit_price, taxable, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`,
        [invoice.id, d.item.id, d.qty, d.unitPrice, d.taxable, d.unitCost]
      );
    }
    return { ...invoice, lines: lineDetails.map((d) => ({ itemId: d.item.id, name: d.item.name, qty: d.qty, price: d.unitPrice })) };
  });
  res.status(201).json(result);
}));

router.get('/invoices', asyncHandler(async (req, res) => {
  const { rows: invoices } = await pool.query(
    `SELECT inv.*, w.name AS warehouse_name, c.name AS cashier_name
     FROM pos_invoices inv
     JOIN subledger_entities w ON w.id = inv.warehouse_id
     JOIN subledger_entities c ON c.id = inv.cashier_id
     ORDER BY inv.issued_at DESC`
  );
  res.json(invoices);
}));

router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: invRows } = await pool.query(
    `SELECT inv.*, w.name AS warehouse_name, c.name AS cashier_name
     FROM pos_invoices inv
     JOIN subledger_entities w ON w.id = inv.warehouse_id
     JOIN subledger_entities c ON c.id = inv.cashier_id
     WHERE inv.id = $1`,
    [id]
  );
  if (!invRows[0]) throw new ApiError(404, 'فاتورة غير موجودة');
  const { rows: lines } = await pool.query(
    `SELECT l.*, i.name FROM pos_invoice_lines l JOIN items i ON i.id = l.item_id WHERE l.invoice_id = $1`,
    [id]
  );
  res.json({ ...invRows[0], lines });
}));

module.exports = router;
