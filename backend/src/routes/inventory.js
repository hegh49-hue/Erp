const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { postJournalEntry, accountBalance } = require('../services/accounting');
const { getAccountByCode, getInventoryControlAccount, getStockBalance, upsertStockBalance, receiveStock, issueStock } = require('../services/inventory');

const router = express.Router();

// ---------- Warehouses (analytical elements under account 1200) ----------
router.get('/warehouses', asyncHandler(async (req, res) => {
  const invAccount = await getInventoryControlAccount(pool);
  const { rows: warehouses } = await pool.query(
    'SELECT * FROM subledger_entities WHERE control_account_id = $1 AND is_active ORDER BY code',
    [invAccount.id]
  );
  const withBalance = await Promise.all(warehouses.map(async (w) => {
    const { debit, credit } = await accountBalance(pool, { accountId: invAccount.id, entityId: w.id });
    const { rows: qtyRows } = await pool.query(
      'SELECT COALESCE(SUM(qty),0)::numeric AS total_qty FROM stock_balances WHERE warehouse_id = $1', [w.id]
    );
    return { ...w, value: debit - credit, totalQty: Number(qtyRows[0].total_qty) };
  }));
  res.json(withBalance);
}));

router.post('/warehouses', asyncHandler(async (req, res) => {
  const { name, code } = req.body;
  if (!name) throw new ApiError(400, 'اسم المستودع مطلوب');
  const invAccount = await getInventoryControlAccount(pool);
  let finalCode = code;
  if (!finalCode) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM subledger_entities WHERE control_account_id = $1', [invAccount.id]);
    finalCode = `WH-${rows[0].n + 1}`;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO subledger_entities (control_account_id, code, name) VALUES ($1,$2,$3) RETURNING *`,
      [invAccount.id, finalCode, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'رمز المستودع مستخدم مسبقاً');
    throw err;
  }
}));

// ---------- Items catalog ----------
router.get('/items', asyncHandler(async (req, res) => {
  const { rows: items } = await pool.query('SELECT * FROM items WHERE is_active ORDER BY name');
  const { rows: balances } = await pool.query(
    `SELECT sb.item_id, sb.warehouse_id, sb.qty, sb.avg_cost, e.code AS warehouse_code, e.name AS warehouse_name
     FROM stock_balances sb JOIN subledger_entities e ON e.id = sb.warehouse_id`
  );
  const byItem = new Map();
  for (const b of balances) {
    if (!byItem.has(b.item_id)) byItem.set(b.item_id, []);
    byItem.get(b.item_id).push(b);
  }
  res.json(items.map((it) => {
    const stock = byItem.get(it.id) || [];
    return { ...it, stock, totalQty: stock.reduce((s, b) => s + Number(b.qty), 0) };
  }));
}));

router.post('/items', asyncHandler(async (req, res) => {
  const { sku, name, category, itemType, unit, price, taxable, isSellable, isStockTracked, reorderPoint } = req.body;
  if (!name) throw new ApiError(400, 'اسم الصنف مطلوب');
  try {
    const { rows } = await pool.query(
      `INSERT INTO items (sku, name, category, item_type, unit, price, taxable, is_sellable, is_stock_tracked, reorder_point)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [sku || null, name, category || 'عام', itemType || 'finished', unit || 'قطعة', Number(price) || 0,
        taxable !== false, isSellable !== false, isStockTracked !== false, Number(reorderPoint) || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'رمز الصنف (SKU) مستخدم مسبقاً');
    throw err;
  }
}));

router.put('/items/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, category, itemType, unit, price, taxable, isSellable, isStockTracked, reorderPoint } = req.body;
  const { rows } = await pool.query(
    `UPDATE items SET name=$1, category=$2, item_type=$3, unit=$4, price=$5, taxable=$6, is_sellable=$7, is_stock_tracked=$8, reorder_point=$9, updated_at=now()
     WHERE id=$10 RETURNING *`,
    [name, category, itemType, unit, Number(price) || 0, !!taxable, !!isSellable, !!isStockTracked, Number(reorderPoint) || 0, id]
  );
  if (!rows[0]) throw new ApiError(404, 'صنف غير موجود');
  res.json(rows[0]);
}));

// ---------- Manual receipt (opening balance / stock intake before a Purchases module exists) ----------
router.post('/items/:id/receive', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { warehouseId, qty, unitCost, date, note } = req.body;
  if (!warehouseId) throw new ApiError(400, 'المستودع مطلوب');
  const result = await withTransaction(async (client) => {
    const invAccount = await getInventoryControlAccount(client);
    const openingAccount = await getAccountByCode(client, '3900');
    const moveDate = date || new Date().toISOString().slice(0, 10);
    const stock = await receiveStock(client, {
      itemId: id, warehouseId, qty: Number(qty), unitCost: Number(unitCost) || 0,
      moveDate, note, refType: 'manual_receipt', createdBy: req.user.id,
    });
    const value = Number(qty) * (Number(unitCost) || 0);
    let entry = null;
    if (value > 0) {
      entry = await postJournalEntry(client, {
        entryDate: moveDate,
        description: note || 'استلام مخزون يدوي',
        sourceType: 'inventory_receipt',
        sourceId: id,
        createdBy: req.user.id,
        lines: [
          { accountId: invAccount.id, debit: value, credit: 0, entityId: warehouseId },
          { accountId: openingAccount.id, debit: 0, credit: value },
        ],
      });
    }
    return { stock, entry };
  });
  res.status(201).json(result);
}));

// ---------- Manual adjustment (+/-) e.g. damage, shrinkage found outside a formal count ----------
router.post('/items/:id/adjust', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { warehouseId, qty, date, note } = req.body;
  const delta = Number(qty);
  if (!warehouseId) throw new ApiError(400, 'المستودع مطلوب');
  if (!delta) throw new ApiError(400, 'كمية التسوية يجب ألا تساوي صفر');
  const result = await withTransaction(async (client) => {
    const invAccount = await getInventoryControlAccount(client);
    const varianceAccount = await getAccountByCode(client, '5900');
    const moveDate = date || new Date().toISOString().slice(0, 10);
    const current = await getStockBalance(client, id, warehouseId);
    let value;
    if (delta > 0) {
      value = delta * Number(current.avg_cost);
      await upsertStockBalance(client, { itemId: id, warehouseId, qty: Number(current.qty) + delta, avgCost: current.avg_cost });
      await client.query(
        `INSERT INTO stock_moves (item_id, warehouse_id, move_type, qty, unit_cost, ref_type, move_date, note, created_by)
         VALUES ($1,$2,'adjustment_in',$3,$4,'manual_adjustment',$5,$6,$7)`,
        [id, warehouseId, delta, current.avg_cost, moveDate, note || null, req.user.id]
      );
    } else {
      const outQty = -delta;
      if (Number(current.qty) < outQty) throw new ApiError(400, 'الكمية المتوفرة غير كافية لهذه التسوية');
      value = outQty * Number(current.avg_cost);
      await upsertStockBalance(client, { itemId: id, warehouseId, qty: Number(current.qty) - outQty, avgCost: current.avg_cost });
      await client.query(
        `INSERT INTO stock_moves (item_id, warehouse_id, move_type, qty, unit_cost, ref_type, move_date, note, created_by)
         VALUES ($1,$2,'adjustment_out',$3,$4,'manual_adjustment',$5,$6,$7)`,
        [id, warehouseId, outQty, current.avg_cost, moveDate, note || null, req.user.id]
      );
    }
    let entry = null;
    if (value > 0) {
      const lines = delta > 0
        ? [{ accountId: invAccount.id, debit: value, credit: 0, entityId: warehouseId }, { accountId: varianceAccount.id, debit: 0, credit: value }]
        : [{ accountId: varianceAccount.id, debit: value, credit: 0 }, { accountId: invAccount.id, debit: 0, credit: value, entityId: warehouseId }];
      entry = await postJournalEntry(client, {
        entryDate: moveDate,
        description: note || 'تسوية مخزون يدوية',
        sourceType: 'inventory_adjustment',
        sourceId: id,
        createdBy: req.user.id,
        lines,
      });
    }
    return { entry };
  });
  res.status(201).json(result);
}));

// ---------- Transfers between warehouses ----------
router.get('/transfers', asyncHandler(async (req, res) => {
  const { rows: transfers } = await pool.query(
    `SELECT t.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name
     FROM stock_transfers t
     JOIN subledger_entities fw ON fw.id = t.from_warehouse_id
     JOIN subledger_entities tw ON tw.id = t.to_warehouse_id
     ORDER BY t.transfer_date DESC, t.created_at DESC`
  );
  const { rows: lines } = await pool.query(
    `SELECT tl.*, i.name AS item_name FROM stock_transfer_lines tl JOIN items i ON i.id = tl.item_id`
  );
  const byTransfer = new Map();
  for (const l of lines) {
    if (!byTransfer.has(l.transfer_id)) byTransfer.set(l.transfer_id, []);
    byTransfer.get(l.transfer_id).push(l);
  }
  res.json(transfers.map((t) => ({ ...t, lines: byTransfer.get(t.id) || [] })));
}));

router.post('/transfers', asyncHandler(async (req, res) => {
  const { fromWarehouseId, toWarehouseId, date, note, lines } = req.body;
  if (!fromWarehouseId || !toWarehouseId) throw new ApiError(400, 'المستودع المصدر والوجهة مطلوبان');
  if (fromWarehouseId === toWarehouseId) throw new ApiError(400, 'لا يمكن التحويل لنفس المستودع');
  if (!Array.isArray(lines) || lines.length === 0) throw new ApiError(400, 'أضف صنفاً واحداً على الأقل للتحويل');

  const result = await withTransaction(async (client) => {
    const invAccount = await getInventoryControlAccount(client);
    const moveDate = date || new Date().toISOString().slice(0, 10);
    const { rows: transferRows } = await client.query(
      `INSERT INTO stock_transfers (transfer_date, from_warehouse_id, to_warehouse_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [moveDate, fromWarehouseId, toWarehouseId, note || null, req.user.id]
    );
    const transfer = transferRows[0];
    let totalValue = 0;
    for (const line of lines) {
      const qty = Number(line.qty);
      if (!(qty > 0)) throw new ApiError(400, 'كمية غير صحيحة ضمن سطور التحويل');
      const fromBalance = await getStockBalance(client, line.itemId, fromWarehouseId);
      if (Number(fromBalance.qty) < qty) throw new ApiError(400, `الكمية غير كافية بالمستودع المصدر للصنف`);
      const unitCost = Number(fromBalance.avg_cost);
      await issueStock(client, {
        itemId: line.itemId, warehouseId: fromWarehouseId, qty, moveDate,
        note: 'تحويل صادر', refType: 'transfer', refId: transfer.id, createdBy: req.user.id,
      });
      await receiveStock(client, {
        itemId: line.itemId, warehouseId: toWarehouseId, qty, unitCost, moveDate,
        note: 'تحويل وارد', refType: 'transfer', refId: transfer.id, createdBy: req.user.id,
      });
      await client.query(
        `INSERT INTO stock_transfer_lines (transfer_id, item_id, qty, unit_cost) VALUES ($1,$2,$3,$4)`,
        [transfer.id, line.itemId, qty, unitCost]
      );
      totalValue += qty * unitCost;
    }

    let entry = null;
    if (totalValue > 0) {
      entry = await postJournalEntry(client, {
        entryDate: moveDate,
        description: note || 'تحويل مخزون بين مستودعين',
        sourceType: 'inventory_transfer',
        sourceId: transfer.id,
        createdBy: req.user.id,
        lines: [
          { accountId: invAccount.id, debit: totalValue, credit: 0, entityId: toWarehouseId },
          { accountId: invAccount.id, debit: 0, credit: totalValue, entityId: fromWarehouseId },
        ],
      });
      await client.query('UPDATE stock_transfers SET journal_entry_id = $1 WHERE id = $2', [entry.id, transfer.id]);
    }
    return { ...transfer, journal_entry_id: entry?.id || null, totalValue };
  });
  res.status(201).json(result);
}));

// ---------- Physical stock counts (جرد) ----------
router.get('/counts', asyncHandler(async (req, res) => {
  const { rows: counts } = await pool.query(
    `SELECT c.*, w.name AS warehouse_name FROM stock_counts c JOIN subledger_entities w ON w.id = c.warehouse_id ORDER BY c.created_at DESC`
  );
  res.json(counts);
}));

router.get('/counts/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: countRows } = await pool.query(
    `SELECT c.*, w.name AS warehouse_name FROM stock_counts c JOIN subledger_entities w ON w.id = c.warehouse_id WHERE c.id = $1`,
    [id]
  );
  if (!countRows[0]) throw new ApiError(404, 'جرد غير موجود');
  const { rows: lines } = await pool.query(
    `SELECT cl.*, i.name AS item_name, i.unit FROM stock_count_lines cl JOIN items i ON i.id = cl.item_id WHERE cl.count_id = $1 ORDER BY i.name`,
    [id]
  );
  res.json({ ...countRows[0], lines });
}));

router.post('/counts', asyncHandler(async (req, res) => {
  const { warehouseId, date, note } = req.body;
  if (!warehouseId) throw new ApiError(400, 'المستودع مطلوب');
  const result = await withTransaction(async (client) => {
    const { rows: countRows } = await client.query(
      `INSERT INTO stock_counts (warehouse_id, count_date, note, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [warehouseId, date || new Date().toISOString().slice(0, 10), note || null, req.user.id]
    );
    const count = countRows[0];
    const { rows: balances } = await client.query(
      `SELECT sb.item_id, sb.qty, sb.avg_cost FROM stock_balances sb
       JOIN items i ON i.id = sb.item_id
       WHERE sb.warehouse_id = $1 AND i.is_stock_tracked AND i.is_active AND sb.qty <> 0`,
      [warehouseId]
    );
    for (const b of balances) {
      await client.query(
        `INSERT INTO stock_count_lines (count_id, item_id, system_qty, unit_cost) VALUES ($1,$2,$3,$4)`,
        [count.id, b.item_id, b.qty, b.avg_cost]
      );
    }
    return count;
  });
  res.status(201).json(result);
}));

router.put('/counts/:id/lines', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { lines } = req.body;
  const { rows: countRows } = await pool.query('SELECT status FROM stock_counts WHERE id = $1', [id]);
  if (!countRows[0]) throw new ApiError(404, 'جرد غير موجود');
  if (countRows[0].status !== 'draft') throw new ApiError(409, 'لا يمكن تعديل جرد مُرحَّل');
  for (const line of lines || []) {
    await pool.query(
      `UPDATE stock_count_lines SET counted_qty = $1 WHERE count_id = $2 AND item_id = $3`,
      [line.countedQty, id, line.itemId]
    );
  }
  res.status(204).end();
}));

router.post('/counts/:id/post', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await withTransaction(async (client) => {
    const { rows: countRows } = await client.query('SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE', [id]);
    const count = countRows[0];
    if (!count) throw new ApiError(404, 'جرد غير موجود');
    if (count.status !== 'draft') throw new ApiError(409, 'هذا الجرد مُرحَّل بالفعل');
    const { rows: lines } = await client.query('SELECT * FROM stock_count_lines WHERE count_id = $1', [id]);
    if (lines.some((l) => l.counted_qty === null)) throw new ApiError(400, 'أكمل إدخال الكمية الفعلية لكل الأصناف قبل الترحيل');

    let sumPositive = 0, sumNegative = 0;
    for (const line of lines) {
      const variance = Number(line.counted_qty) - Number(line.system_qty);
      if (variance === 0) continue;
      const unitCost = Number(line.unit_cost);
      await upsertStockBalance(client, { itemId: line.item_id, warehouseId: count.warehouse_id, qty: Number(line.counted_qty), avgCost: unitCost });
      await client.query(
        `INSERT INTO stock_moves (item_id, warehouse_id, move_type, qty, unit_cost, ref_type, ref_id, move_date, note, created_by)
         VALUES ($1,$2,'count_adjustment',$3,$4,'stock_count',$5,$6,$7,$8)`,
        [line.item_id, count.warehouse_id, Math.abs(variance), unitCost, count.id, count.count_date, 'فرق جرد', req.user.id]
      );
      if (variance > 0) sumPositive += variance * unitCost; else sumNegative += -variance * unitCost;
    }

    const invAccount = await getInventoryControlAccount(client);
    const varianceAccount = await getAccountByCode(client, '5900');
    const journalLines = [];
    if (sumPositive > 0) {
      journalLines.push({ accountId: invAccount.id, debit: sumPositive, credit: 0, entityId: count.warehouse_id });
      journalLines.push({ accountId: varianceAccount.id, debit: 0, credit: sumPositive });
    }
    if (sumNegative > 0) {
      journalLines.push({ accountId: varianceAccount.id, debit: sumNegative, credit: 0 });
      journalLines.push({ accountId: invAccount.id, debit: 0, credit: sumNegative, entityId: count.warehouse_id });
    }
    let entry = null;
    if (journalLines.length) {
      entry = await postJournalEntry(client, {
        entryDate: count.count_date,
        description: `ترحيل جرد مخزون - ${count.id}`,
        sourceType: 'stock_count',
        sourceId: count.id,
        createdBy: req.user.id,
        lines: journalLines,
      });
    }
    await client.query(
      `UPDATE stock_counts SET status='posted', posted_at=now(), journal_entry_id=$1 WHERE id=$2`,
      [entry?.id || null, id]
    );
    return { id, journalEntryId: entry?.id || null, sumPositive, sumNegative };
  });
  res.json(result);
}));

// ---------- BOM (recipe definitions; consumption happens in the Production module) ----------
router.get('/boms', asyncHandler(async (req, res) => {
  const { rows: boms } = await pool.query(
    `SELECT b.*, i.name AS output_item_name, i.unit AS output_unit FROM boms b JOIN items i ON i.id = b.output_item_id WHERE b.is_active ORDER BY b.created_at DESC`
  );
  const { rows: lines } = await pool.query(
    `SELECT bl.*, i.name AS component_name, i.unit AS component_unit FROM bom_lines bl JOIN items i ON i.id = bl.component_item_id`
  );
  const byBom = new Map();
  for (const l of lines) {
    if (!byBom.has(l.bom_id)) byBom.set(l.bom_id, []);
    byBom.get(l.bom_id).push(l);
  }
  res.json(boms.map((b) => ({ ...b, lines: byBom.get(b.id) || [] })));
}));

router.post('/boms', asyncHandler(async (req, res) => {
  const { outputItemId, name, outputQty, lines } = req.body;
  if (!outputItemId) throw new ApiError(400, 'الصنف الناتج مطلوب');
  if (!Array.isArray(lines) || lines.length === 0) throw new ApiError(400, 'أضف مكوّناً واحداً على الأقل للوصفة');
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO boms (output_item_id, name, output_qty) VALUES ($1,$2,$3) RETURNING *`,
      [outputItemId, name || 'وصفة قياسية', Number(outputQty) || 1]
    );
    const bom = rows[0];
    for (const line of lines) {
      if (line.componentItemId === outputItemId) throw new ApiError(400, 'لا يمكن أن يكون الصنف الناتج مكوّناً في وصفته نفسها');
      await client.query(
        `INSERT INTO bom_lines (bom_id, component_item_id, qty) VALUES ($1,$2,$3)`,
        [bom.id, line.componentItemId, Number(line.qty)]
      );
    }
    return bom;
  });
  res.status(201).json(result);
}));

router.delete('/boms/:id', asyncHandler(async (req, res) => {
  await pool.query('UPDATE boms SET is_active = false WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
