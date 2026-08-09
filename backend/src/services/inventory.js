const { ApiError } = require('../middleware/asyncHandler');
const { postJournalEntry } = require('./accounting');

async function getAccountByCode(client, code) {
  const { rows } = await client.query('SELECT * FROM accounts WHERE code = $1', [code]);
  if (!rows[0]) throw new ApiError(500, `حساب أساسي مفقود: ${code}`);
  return rows[0];
}

async function getInventoryControlAccount(client) {
  return getAccountByCode(client, '1200');
}

async function getStockBalance(client, itemId, warehouseId) {
  const { rows } = await client.query(
    'SELECT * FROM stock_balances WHERE item_id = $1 AND warehouse_id = $2',
    [itemId, warehouseId]
  );
  return rows[0] || { item_id: itemId, warehouse_id: warehouseId, qty: 0, avg_cost: 0 };
}

async function upsertStockBalance(client, { itemId, warehouseId, qty, avgCost }) {
  await client.query(
    `INSERT INTO stock_balances (item_id, warehouse_id, qty, avg_cost)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (item_id, warehouse_id) DO UPDATE SET qty = $3, avg_cost = $4`,
    [itemId, warehouseId, qty, avgCost]
  );
}

/** Increase stock via a receipt, updating the moving weighted-average cost. */
async function receiveStock(client, { itemId, warehouseId, qty, unitCost, moveDate, note, refType, refId, createdBy }) {
  if (!(qty > 0)) throw new ApiError(400, 'الكمية يجب أن تكون أكبر من صفر');
  if (unitCost < 0) throw new ApiError(400, 'التكلفة لا يمكن أن تكون سالبة');
  const current = await getStockBalance(client, itemId, warehouseId);
  const newQty = Number(current.qty) + Number(qty);
  const newAvgCost = newQty > 0
    ? ((Number(current.qty) * Number(current.avg_cost)) + (Number(qty) * Number(unitCost))) / newQty
    : 0;
  await upsertStockBalance(client, { itemId, warehouseId, qty: newQty, avgCost: newAvgCost });
  await client.query(
    `INSERT INTO stock_moves (item_id, warehouse_id, move_type, qty, unit_cost, ref_type, ref_id, move_date, note, created_by)
     VALUES ($1,$2,'receipt',$3,$4,$5,$6,$7,$8,$9)`,
    [itemId, warehouseId, qty, unitCost, refType || 'manual', refId || null, moveDate, note || null, createdBy || null]
  );
  return { qty: newQty, avgCost: newAvgCost };
}

/** Decrease stock (e.g. a sale or manual issue). Cost is taken from current moving average. */
async function issueStock(client, { itemId, warehouseId, qty, moveDate, note, refType, refId, createdBy }) {
  if (!(qty > 0)) throw new ApiError(400, 'الكمية يجب أن تكون أكبر من صفر');
  const current = await getStockBalance(client, itemId, warehouseId);
  if (Number(current.qty) < Number(qty)) throw new ApiError(400, 'الكمية المتوفرة بالمستودع غير كافية');
  const unitCost = Number(current.avg_cost);
  const newQty = Number(current.qty) - Number(qty);
  await upsertStockBalance(client, { itemId, warehouseId, qty: newQty, avgCost: unitCost });
  await client.query(
    `INSERT INTO stock_moves (item_id, warehouse_id, move_type, qty, unit_cost, ref_type, ref_id, move_date, note, created_by)
     VALUES ($1,$2,'issue',$3,$4,$5,$6,$7,$8,$9)`,
    [itemId, warehouseId, qty, unitCost, refType || 'manual', refId || null, moveDate, note || null, createdBy || null]
  );
  return { qty: newQty, unitCost };
}

module.exports = {
  getAccountByCode,
  getInventoryControlAccount,
  getStockBalance,
  upsertStockBalance,
  receiveStock,
  issueStock,
};
