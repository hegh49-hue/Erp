const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { postJournalEntry } = require('../services/accounting');
const { getAccountByCode, issueStock, receiveStock } = require('../services/inventory');
const { computeBusinessDate } = require('../services/businessDay');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
// Accountants have no business in POS at all (spec: cashier=POS only, accountant=accounting+reports only).
router.use(requireRole('admin', 'cashier'));
const adminOnly = requireRole('admin');

/** A cashier-role user may only ever act on the cashbox entity they're linked to. */
function assertOwnCashier(req, cashierId) {
  if (req.user.role === 'cashier' && cashierId !== req.user.cashierEntityId) {
    throw new ApiError(403, 'لا يمكنك العمل إلا على صندوقك الخاص');
  }
}

// ---------- Cashiers are analytical elements under 1000 (cash box control account) ----------
router.get('/cashiers', asyncHandler(async (req, res) => {
  const cashAccount = await getAccountByCode(pool, '1000');
  const { rows } = await pool.query(
    'SELECT * FROM subledger_entities WHERE control_account_id = $1 AND is_active ORDER BY code',
    [cashAccount.id]
  );
  res.json(rows);
}));

router.post('/cashiers', adminOnly, asyncHandler(async (req, res) => {
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
  const {
    cashierId, warehouseId, orderType, orderSource, payMethod, payEntityId, payMethodLabel, items,
    customerId, loyaltyPointsToRedeem, customerName, customerPhone, customerArea, orderNote,
  } = req.body;
  if (!cashierId) throw new ApiError(400, 'يرجى اختيار الكاشير');
  assertOwnCashier(req, cashierId);
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'السلة فارغة');
  if (payMethod === 'credit_customer' && !customerId) throw new ApiError(400, 'يرجى اختيار العميل للبيع الآجل');

  const result = await withTransaction(async (client) => {
    const { rows: companyRows } = await client.query('SELECT * FROM companies ORDER BY created_at LIMIT 1');
    const company = companyRows[0];
    if (!company?.vat_number) throw new ApiError(400, 'يرجى إدخال الرقم الضريبي في الإعدادات أولاً');

    const itemIds = items.map((i) => i.itemId);
    const { rows: itemRows } = await client.query('SELECT * FROM items WHERE id = ANY($1::uuid[])', [itemIds]);
    const itemsById = new Map(itemRows.map((i) => [i.id, i]));

    // Recipe (BOM) items consume their raw components instead of their own stock — see routes note below.
    // If an item somehow has more than one active BOM, only the most recently created one is used
    // (never merged — that would silently double-consume components).
    const { rows: bomRows } = await client.query(
      `SELECT b.id AS bom_id, b.output_item_id, b.output_qty, bl.component_item_id, bl.qty AS component_qty
       FROM boms b JOIN bom_lines bl ON bl.bom_id = b.id
       WHERE b.output_item_id = ANY($1::uuid[]) AND b.is_active
       ORDER BY b.created_at DESC`,
      [itemIds]
    );
    const chosenBomIdByItem = new Map();
    const bomByItem = new Map();
    for (const r of bomRows) {
      if (!chosenBomIdByItem.has(r.output_item_id)) chosenBomIdByItem.set(r.output_item_id, r.bom_id);
      if (chosenBomIdByItem.get(r.output_item_id) !== r.bom_id) continue;
      if (!bomByItem.has(r.output_item_id)) bomByItem.set(r.output_item_id, { outputQty: Number(r.output_qty), components: [] });
      bomByItem.get(r.output_item_id).components.push({ componentItemId: r.component_item_id, qty: Number(r.component_qty) });
    }

    const requiresWarehouse = itemRows.some((i) => bomByItem.has(i.id) || i.is_stock_tracked);
    if (requiresWarehouse && !warehouseId) throw new ApiError(400, 'يرجى اختيار المستودع — السلة تحتوي أصنافاً سلعية');
    const effectiveWarehouseId = requiresWarehouse ? warehouseId : (warehouseId || null);

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
      const bom = bomByItem.get(item.id);
      if (bom) {
        let lineCost = 0;
        for (const comp of bom.components) {
          const componentQty = (comp.qty * qty) / bom.outputQty;
          const stock = await issueStock(client, {
            itemId: comp.componentItemId, warehouseId: effectiveWarehouseId, qty: componentQty,
            moveDate: new Date().toISOString().slice(0, 10), note: `استهلاك وصفة — فاتورة مبيعات`,
            refType: 'pos_sale_bom', createdBy: req.user.id,
          });
          lineCost += stock.unitCost * componentQty;
        }
        unitCost = lineCost / qty;
        cogsTotal += lineCost;
      } else if (item.is_stock_tracked) {
        const stock = await issueStock(client, {
          itemId: item.id, warehouseId: effectiveWarehouseId, qty, moveDate: new Date().toISOString().slice(0, 10),
          note: 'فاتورة مبيعات', refType: 'pos_sale', createdBy: req.user.id,
        });
        unitCost = stock.unitCost;
        cogsTotal += unitCost * qty;
      }
      lineDetails.push({ item, qty, unitPrice: item.price, taxable: item.taxable, unitCost });
    }

    // Loyalty points redemption: discount applied proportionally to subtotal/VAT before totalling.
    let loyaltyDiscount = 0, pointsRedeemed = 0;
    let customerEntity = null;
    if (customerId) {
      const { rows: custRows } = await client.query('SELECT * FROM subledger_entities WHERE id = $1', [customerId]);
      customerEntity = custRows[0];
      if (!customerEntity) throw new ApiError(400, 'عميل غير موجود');
      pointsRedeemed = Math.max(0, parseInt(loyaltyPointsToRedeem, 10) || 0);
      const availablePoints = Number(customerEntity.extra?.loyaltyPoints) || 0;
      if (pointsRedeemed > availablePoints) throw new ApiError(400, `رصيد النقاط غير كافٍ (المتاح: ${availablePoints})`);
      if (pointsRedeemed > 0) {
        const rawDiscount = pointsRedeemed * Number(company.loyalty_point_value);
        loyaltyDiscount = Math.min(rawDiscount, subtotal + vat);
      }
    }
    let finalSubtotal = subtotal, finalVat = vat;
    if (loyaltyDiscount > 0 && subtotal > 0) {
      const ratio = Math.max(0, (subtotal + vat - loyaltyDiscount)) / (subtotal + vat);
      finalSubtotal = subtotal * ratio;
      finalVat = vat * ratio;
    }
    const total = finalSubtotal + finalVat;
    const pointsEarned = Math.floor(total / Number(company.loyalty_riyal_per_point || 10));

    let payAccount, payEntity = payEntityId || null;
    if (payMethod === 'channel' && payEntityId) {
      payAccount = await getAccountByCode(client, '1150');
    } else if (payMethod === 'credit_customer') {
      payAccount = await getAccountByCode(client, '1100');
      payEntity = customerId;
    } else {
      payAccount = await getAccountByCode(client, '1000');
      payEntity = cashierId;
    }
    const revenueAccount = await getAccountByCode(client, '4000');
    const vatAccount = await getAccountByCode(client, '2100');

    const revenueLines = [{ accountId: payAccount.id, debit: total, credit: 0, entityId: payEntity }];
    revenueLines.push({ accountId: revenueAccount.id, debit: 0, credit: finalSubtotal });
    if (finalVat > 0) revenueLines.push({ accountId: vatAccount.id, debit: 0, credit: finalVat });

    const { rows: seqRows } = await client.query("SELECT nextval('pos_invoice_seq') AS n");
    const number = String(seqRows[0].n).padStart(6, '0');
    const now = new Date();
    const isoTs = now.toISOString();
    const businessDate = computeBusinessDate(now, company.business_day_start_hour);
    const qrBase64 = buildZatcaQR(company.name, company.vat_number, isoTs, total, finalVat);

    const revenueEntry = await postJournalEntry(client, {
      entryDate: businessDate,
      description: `فاتورة مبيعات #${number}`,
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
        entryDate: businessDate,
        description: `تكلفة البضاعة المباعة - فاتورة #${number}`,
        reference: number,
        sourceType: 'pos_sale_cogs',
        createdBy: req.user.id,
        lines: [
          { accountId: cogsAccount.id, debit: cogsTotal, credit: 0 },
          { accountId: invAccount.id, debit: 0, credit: cogsTotal, entityId: effectiveWarehouseId },
        ],
      });
    }

    if (customerEntity) {
      const newPoints = (Number(customerEntity.extra?.loyaltyPoints) || 0) - pointsRedeemed + pointsEarned;
      await client.query(
        `UPDATE subledger_entities SET extra = jsonb_set(extra, '{loyaltyPoints}', $1::jsonb) WHERE id = $2`,
        [JSON.stringify(newPoints), customerId]
      );
    }

    const { rows: invRows } = await client.query(
      `INSERT INTO pos_invoices (number, issued_at, business_date, warehouse_id, cashier_id, order_type, order_source, pay_method_label,
         pay_account_id, pay_entity_id, subtotal, vat, total, cogs_total, qr_base64, journal_entry_id, cogs_entry_id, created_by,
         customer_id, loyalty_points_earned, loyalty_points_redeemed, loyalty_discount,
         customer_name, customer_phone, customer_area, order_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
      [number, isoTs, businessDate, effectiveWarehouseId, cashierId, orderType || 'محلي', orderSource || 'محلي', payMethodLabel || payMethod,
        payAccount.id, payEntity, finalSubtotal, finalVat, total, cogsTotal, qrBase64, revenueEntry.id, cogsEntry?.id || null, req.user.id,
        customerId || null, pointsEarned, pointsRedeemed, loyaltyDiscount,
        (customerName || '').trim() || null, (customerPhone || '').trim() || null, (customerArea || '').trim() || null, (orderNote || '').trim() || null]
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
    `SELECT inv.*, w.name AS warehouse_name, c.name AS cashier_name, orig.number AS original_invoice_number
     FROM pos_invoices inv
     LEFT JOIN subledger_entities w ON w.id = inv.warehouse_id
     JOIN subledger_entities c ON c.id = inv.cashier_id
     LEFT JOIN pos_invoices orig ON orig.id = inv.original_invoice_id
     ORDER BY inv.issued_at DESC`
  );
  res.json(invoices);
}));

router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: invRows } = await pool.query(
    `SELECT inv.*, w.name AS warehouse_name, c.name AS cashier_name, orig.number AS original_invoice_number
     FROM pos_invoices inv
     LEFT JOIN subledger_entities w ON w.id = inv.warehouse_id
     JOIN subledger_entities c ON c.id = inv.cashier_id
     LEFT JOIN pos_invoices orig ON orig.id = inv.original_invoice_id
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

// ---------- Sales returns (credit notes) ----------
async function remainingReturnableByItem(client, originalInvoiceId) {
  const { rows: soldLines } = await client.query(
    `SELECT item_id, qty, unit_price, taxable, unit_cost FROM pos_invoice_lines WHERE invoice_id = $1`,
    [originalInvoiceId]
  );
  const { rows: returnedLines } = await client.query(
    `SELECT l.item_id, COALESCE(SUM(l.qty),0)::numeric AS returned_qty
     FROM pos_invoice_lines l
     JOIN pos_invoices inv ON inv.id = l.invoice_id
     WHERE inv.original_invoice_id = $1 AND inv.doc_type = 'credit_note'
     GROUP BY l.item_id`,
    [originalInvoiceId]
  );
  const returnedByItem = new Map(returnedLines.map((r) => [r.item_id, Number(r.returned_qty)]));
  return soldLines.map((l) => ({
    itemId: l.item_id,
    soldQty: Number(l.qty),
    unitPrice: Number(l.unit_price),
    taxable: l.taxable,
    unitCost: Number(l.unit_cost),
    alreadyReturnedQty: returnedByItem.get(l.item_id) || 0,
    remainingQty: Number(l.qty) - (returnedByItem.get(l.item_id) || 0),
  }));
}

router.get('/invoices/by-number/:number', asyncHandler(async (req, res) => {
  const { number } = req.params;
  const { rows } = await pool.query(
    `SELECT inv.*, w.name AS warehouse_name, c.name AS cashier_name
     FROM pos_invoices inv
     LEFT JOIN subledger_entities w ON w.id = inv.warehouse_id
     JOIN subledger_entities c ON c.id = inv.cashier_id
     WHERE inv.number = $1 AND inv.doc_type = 'sale'`,
    [number]
  );
  const invoice = rows[0];
  if (!invoice) throw new ApiError(404, 'لا توجد فاتورة بيع بهذا الرقم');
  const { rows: itemNames } = await pool.query(
    `SELECT l.item_id, i.name, i.unit, i.is_stock_tracked FROM pos_invoice_lines l JOIN items i ON i.id = l.item_id WHERE l.invoice_id = $1`,
    [invoice.id]
  );
  const namesById = new Map(itemNames.map((i) => [i.item_id, i]));
  const returnable = await remainingReturnableByItem(pool, invoice.id);
  const lines = returnable.map((r) => ({ ...r, name: namesById.get(r.itemId)?.name, unit: namesById.get(r.itemId)?.unit, isStockTracked: namesById.get(r.itemId)?.is_stock_tracked }));
  res.json({ ...invoice, lines });
}));

router.post('/invoices/:id/return', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { lines } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) throw new ApiError(400, 'اختر صنفاً واحداً على الأقل للإرجاع');

  const result = await withTransaction(async (client) => {
    const { rows: origRows } = await client.query('SELECT * FROM pos_invoices WHERE id = $1 FOR UPDATE', [id]);
    const original = origRows[0];
    if (!original) throw new ApiError(404, 'فاتورة غير موجودة');
    if (original.doc_type !== 'sale') throw new ApiError(400, 'لا يمكن إرجاع إشعار دائن');

    const returnable = await remainingReturnableByItem(client, id);
    const returnableByItem = new Map(returnable.map((r) => [r.itemId, r]));

    let subtotal = 0, vat = 0, cogsTotal = 0;
    const lineDetails = [];
    for (const line of lines) {
      const qty = Number(line.qty);
      if (!(qty > 0)) throw new ApiError(400, 'كمية غير صحيحة ضمن سطور الإرجاع');
      const src = returnableByItem.get(line.itemId);
      if (!src) throw new ApiError(400, 'هذا الصنف غير موجود في الفاتورة الأصلية');
      if (qty > src.remainingQty) throw new ApiError(400, `الكمية المطلوب إرجاعها تتجاوز المتبقي القابل للإرجاع (${src.remainingQty})`);
      const lineTotal = src.unitPrice * qty;
      let lineVat = 0;
      if (src.taxable) { lineVat = lineTotal - (lineTotal / 1.15); subtotal += lineTotal - lineVat; vat += lineVat; }
      else subtotal += lineTotal;
      lineDetails.push({ itemId: line.itemId, qty, unitPrice: src.unitPrice, taxable: src.taxable, unitCost: src.unitCost });
    }
    const total = subtotal + vat;

    const { rows: itemRows } = await client.query(
      'SELECT id, is_stock_tracked FROM items WHERE id = ANY($1::uuid[])',
      [lineDetails.map((d) => d.itemId)]
    );
    const trackedById = new Map(itemRows.map((i) => [i.id, i.is_stock_tracked]));
    // Recipe (BOM) items were never stocked as finished goods — their raw components were
    // consumed at sale time and can't be "un-cooked", so returns skip restocking for them.
    const { rows: bomOutputRows } = await client.query(
      `SELECT DISTINCT output_item_id FROM boms WHERE output_item_id = ANY($1::uuid[]) AND is_active`,
      [lineDetails.map((d) => d.itemId)]
    );
    const bomOutputIds = new Set(bomOutputRows.map((r) => r.output_item_id));

    const { rows: companyRows } = await client.query('SELECT business_day_start_hour FROM companies ORDER BY created_at LIMIT 1');
    const now = new Date();
    const isoTs = now.toISOString();
    const entryDate = computeBusinessDate(now, companyRows[0]?.business_day_start_hour ?? 6);

    for (const d of lineDetails) {
      if (trackedById.get(d.itemId) && !bomOutputIds.has(d.itemId) && original.warehouse_id) {
        await receiveStock(client, {
          itemId: d.itemId, warehouseId: original.warehouse_id, qty: d.qty, unitCost: d.unitCost,
          moveDate: entryDate, note: 'مردود مبيعات', refType: 'pos_return', createdBy: req.user.id,
        });
        cogsTotal += d.unitCost * d.qty;
      }
    }

    const revenueAccount = await getAccountByCode(client, '4000');
    const vatAccount = await getAccountByCode(client, '2100');
    const revenueLines = [{ accountId: revenueAccount.id, debit: subtotal, credit: 0 }];
    if (vat > 0) revenueLines.push({ accountId: vatAccount.id, debit: vat, credit: 0 });
    revenueLines.push({ accountId: original.pay_account_id, debit: 0, credit: total, entityId: original.pay_entity_id });

    const { rows: seqRows } = await client.query("SELECT nextval('pos_credit_note_seq') AS n");
    const number = `CN-${String(seqRows[0].n).padStart(6, '0')}`;

    const revenueEntry = await postJournalEntry(client, {
      entryDate, description: `مردود مبيعات - إشعار دائن #${number} (مرجع فاتورة #${original.number})`,
      reference: number, sourceType: 'pos_return', createdBy: req.user.id, lines: revenueLines,
    });

    let cogsEntry = null;
    if (cogsTotal > 0) {
      const cogsAccount = await getAccountByCode(client, '5000');
      const invAccount = await getAccountByCode(client, '1200');
      cogsEntry = await postJournalEntry(client, {
        entryDate, description: `عكس تكلفة البضاعة المباعة - إشعار دائن #${number}`,
        reference: number, sourceType: 'pos_return_cogs', createdBy: req.user.id,
        lines: [
          { accountId: invAccount.id, debit: cogsTotal, credit: 0, entityId: original.warehouse_id },
          { accountId: cogsAccount.id, debit: 0, credit: cogsTotal },
        ],
      });
    }

    const { rows: cnRows } = await client.query(
      `INSERT INTO pos_invoices (number, issued_at, business_date, doc_type, original_invoice_id, warehouse_id, cashier_id, order_type, order_source,
         pay_method_label, pay_account_id, pay_entity_id, subtotal, vat, total, cogs_total, journal_entry_id, cogs_entry_id, created_by)
       VALUES ($1,$2,$3,'credit_note',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [number, isoTs, entryDate, original.id, original.warehouse_id, original.cashier_id, original.order_type, original.order_source,
        original.pay_method_label, original.pay_account_id, original.pay_entity_id, subtotal, vat, total, cogsTotal,
        revenueEntry.id, cogsEntry?.id || null, req.user.id]
    );
    const creditNote = cnRows[0];
    for (const d of lineDetails) {
      await client.query(
        `INSERT INTO pos_invoice_lines (invoice_id, item_id, qty, unit_price, taxable, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`,
        [creditNote.id, d.itemId, d.qty, d.unitPrice, d.taxable, d.unitCost]
      );
    }
    return { ...creditNote, original_invoice_number: original.number };
  });
  res.status(201).json(result);
}));

// ---------- Cashier shifts (till reconciliation) ----------
async function netSalesByMethod(client, { cashierId, payMethodLabel, fromTs, toTs }) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN doc_type = 'sale' THEN total ELSE -total END), 0)::numeric AS net
     FROM pos_invoices
     WHERE cashier_id = $1 AND pay_method_label = $2 AND issued_at >= $3 AND issued_at <= $4`,
    [cashierId, payMethodLabel, fromTs, toTs]
  );
  return Number(rows[0].net);
}
async function getShiftDisbursements(client, { cashierId, fromTs, toTs }) {
  const { rows } = await client.query(
    `SELECT d.*, ea.code AS expense_account_code, ea.name AS expense_account_name
     FROM cash_disbursements d LEFT JOIN accounts ea ON ea.id = d.expense_account_id
     WHERE d.cashier_id = $1 AND d.status = 'approved' AND d.reviewed_at >= $2 AND d.reviewed_at <= $3
     ORDER BY d.reviewed_at`,
    [cashierId, fromTs, toTs]
  );
  return rows;
}
async function computeShiftFinancials(client, { cashierId, openingFloat, fromTs, toTs }) {
  const netCashSales = await netSalesByMethod(client, { cashierId, payMethodLabel: 'نقدي', fromTs, toTs });
  const netNetworkSales = await netSalesByMethod(client, { cashierId, payMethodLabel: 'شبكة', fromTs, toTs });
  const disbursements = await getShiftDisbursements(client, { cashierId, fromTs, toTs });
  const disbursementsTotal = disbursements.reduce((s, d) => s + Number(d.amount), 0);
  const cashExpected = Number(openingFloat) + netCashSales - disbursementsTotal;
  return { netCashSales, netNetworkSales, disbursements, disbursementsTotal, cashExpected, networkExpected: netNetworkSales };
}

router.get('/shifts', asyncHandler(async (req, res) => {
  let { cashierId, status } = req.query;
  if (req.user.role === 'cashier') cashierId = req.user.cashierEntityId;
  const params = [];
  let where = 'TRUE';
  if (cashierId) { params.push(cashierId); where += ` AND s.cashier_id = $${params.length}`; }
  if (status) { params.push(status); where += ` AND s.status = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT s.*, c.name AS cashier_name FROM cashier_shifts s
     JOIN subledger_entities c ON c.id = s.cashier_id
     WHERE ${where} ORDER BY s.opened_at DESC`,
    params
  );
  res.json(rows);
}));

router.get('/shifts/open/:cashierId', asyncHandler(async (req, res) => {
  const { cashierId } = req.params;
  assertOwnCashier(req, cashierId);
  const { rows } = await pool.query(
    `SELECT s.*, c.name AS cashier_name FROM cashier_shifts s
     JOIN subledger_entities c ON c.id = s.cashier_id
     WHERE s.cashier_id = $1 AND s.status = 'open'`,
    [cashierId]
  );
  if (!rows[0]) return res.json(null);
  const financials = await computeShiftFinancials(pool, {
    cashierId, openingFloat: rows[0].opening_float, fromTs: rows[0].opened_at, toTs: new Date(),
  });
  res.json({ ...rows[0], live: financials });
}));

router.get('/shifts/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT s.*, c.name AS cashier_name, o.full_name AS opened_by_name, cl.full_name AS closed_by_name
     FROM cashier_shifts s
     JOIN subledger_entities c ON c.id = s.cashier_id
     LEFT JOIN users o ON o.id = s.opened_by
     LEFT JOIN users cl ON cl.id = s.closed_by
     WHERE s.id = $1`,
    [id]
  );
  const shift = rows[0];
  if (!shift) throw new ApiError(404, 'شفت غير موجود');
  assertOwnCashier(req, shift.cashier_id);
  if (shift.status === 'open') {
    shift.live = await computeShiftFinancials(pool, {
      cashierId: shift.cashier_id, openingFloat: shift.opening_float, fromTs: shift.opened_at, toTs: new Date(),
    });
  } else {
    shift.disbursementsList = await getShiftDisbursements(pool, {
      cashierId: shift.cashier_id, fromTs: shift.opened_at, toTs: shift.closed_at,
    });
  }
  res.json(shift);
}));

router.post('/shifts/open', asyncHandler(async (req, res) => {
  const { cashierId, openingFloat, note } = req.body;
  if (!cashierId) throw new ApiError(400, 'يرجى اختيار الكاشير');
  assertOwnCashier(req, cashierId);
  const float = Number(openingFloat) || 0;
  if (float < 0) throw new ApiError(400, 'الرصيد الافتتاحي لا يمكن أن يكون سالباً');

  const result = await withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      "SELECT id FROM cashier_shifts WHERE cashier_id = $1 AND status = 'open'", [cashierId]
    );
    if (existing[0]) throw new ApiError(409, 'يوجد شفت مفتوح بالفعل لهذا الكاشير');
    const { rows: companyRows } = await client.query('SELECT business_day_start_hour FROM companies ORDER BY created_at LIMIT 1');
    const now = new Date();
    const businessDate = computeBusinessDate(now, companyRows[0]?.business_day_start_hour ?? 6);
    const { rows } = await client.query(
      `INSERT INTO cashier_shifts (cashier_id, business_date, opening_float, opened_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [cashierId, businessDate, float, req.user.id]
    );
    return rows[0];
  });
  res.status(201).json(result);
}));

router.post('/shifts/:id/close', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { denominations, networkCounted, note } = req.body;
  if (!denominations || typeof denominations !== 'object' || Object.keys(denominations).length === 0) {
    throw new ApiError(400, 'يرجى إدخال عدّ النقدية حسب الفئات');
  }
  const cashCounted = Object.entries(denominations).reduce((sum, [value, qty]) => sum + Number(value) * (Number(qty) || 0), 0);
  const netCounted = Number(networkCounted);
  if (!(netCounted >= 0)) throw new ApiError(400, 'يرجى إدخال مبلغ الشبكة الفعلي');

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM cashier_shifts WHERE id = $1 FOR UPDATE', [id]);
    const shift = rows[0];
    if (!shift) throw new ApiError(404, 'شفت غير موجود');
    assertOwnCashier(req, shift.cashier_id);
    if (shift.status !== 'open') throw new ApiError(409, 'هذا الشفت مُغلق بالفعل');
    const now = new Date();
    const financials = await computeShiftFinancials(client, {
      cashierId: shift.cashier_id, openingFloat: shift.opening_float, fromTs: shift.opened_at, toTs: now,
    });
    const cashVariance = cashCounted - financials.cashExpected;
    const networkVariance = netCounted - financials.networkExpected;
    const { rows: updated } = await client.query(
      `UPDATE cashier_shifts SET status='closed', closed_at=$1, closed_by=$2, counted_amount=$3, expected_amount=$4, variance=$5, note=$6,
         denominations=$7, network_counted=$8, network_expected=$9, network_variance=$10, disbursements_total=$11
       WHERE id=$12 RETURNING *`,
      [now, req.user.id, cashCounted, financials.cashExpected, cashVariance, note || null,
        denominations, netCounted, financials.networkExpected, networkVariance, financials.disbursementsTotal, id]
    );
    return { ...updated[0], disbursementsList: financials.disbursements };
  });
  res.json(result);
}));

module.exports = router;
