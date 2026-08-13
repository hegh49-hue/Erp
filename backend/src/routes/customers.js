const express = require('express');
const { pool } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { accountBalance } = require('../services/accounting');

const router = express.Router();

async function getCustomerControlAccount(client) {
  const { rows } = await client.query("SELECT * FROM accounts WHERE code = '1100'");
  if (!rows[0]) throw new ApiError(500, 'حساب أساسي مفقود: 1100');
  return rows[0];
}

router.get('/', asyncHandler(async (req, res) => {
  const { query, customerType } = req.query;
  const account = await getCustomerControlAccount(pool);
  const params = [account.id];
  let where = 'control_account_id = $1 AND is_active';
  if (query) {
    params.push(`%${query}%`);
    where += ` AND (name ILIKE $${params.length} OR (extra->>'phone') ILIKE $${params.length})`;
  }
  if (customerType) {
    params.push(customerType);
    where += ` AND (extra->>'customerType') = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM subledger_entities WHERE ${where} ORDER BY name LIMIT 50`,
    params
  );
  res.json(rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const account = await getCustomerControlAccount(pool);
  const { rows } = await pool.query('SELECT * FROM subledger_entities WHERE id = $1 AND control_account_id = $2', [id, account.id]);
  const customer = rows[0];
  if (!customer) throw new ApiError(404, 'عميل غير موجود');
  const { debit, credit } = await accountBalance(pool, { accountId: account.id, entityId: id });
  res.json({ ...customer, balance: debit - credit });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, phone, notes, customerType, vehicleType } = req.body;
  if (!name) throw new ApiError(400, 'اسم العميل مطلوب');
  const finalType = customerType === 'delivery_rider' ? 'delivery_rider' : 'regular';
  const account = await getCustomerControlAccount(pool);
  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS n FROM subledger_entities WHERE control_account_id = $1', [account.id]);
  const code = `CUST-${countRows[0].n + 1}`;
  const extra = {
    phone: phone || null, notes: notes || null, customerType: finalType,
    vehicleType: finalType === 'delivery_rider' ? (vehicleType || null) : null,
    loyaltyPoints: 0,
  };
  const { rows } = await pool.query(
    `INSERT INTO subledger_entities (control_account_id, code, name, extra) VALUES ($1,$2,$3,$4) RETURNING *`,
    [account.id, code, name, extra]
  );
  res.status(201).json(rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, notes, customerType, vehicleType } = req.body;
  const account = await getCustomerControlAccount(pool);
  const { rows: existing } = await pool.query('SELECT * FROM subledger_entities WHERE id = $1 AND control_account_id = $2', [id, account.id]);
  if (!existing[0]) throw new ApiError(404, 'عميل غير موجود');
  const finalType = customerType === 'delivery_rider' ? 'delivery_rider' : 'regular';
  const extra = {
    ...existing[0].extra,
    phone: phone ?? existing[0].extra.phone,
    notes: notes ?? existing[0].extra.notes,
    customerType: finalType,
    vehicleType: finalType === 'delivery_rider' ? (vehicleType ?? existing[0].extra.vehicleType) : null,
  };
  const { rows } = await pool.query(
    `UPDATE subledger_entities SET name = $1, extra = $2 WHERE id = $3 RETURNING *`,
    [name || existing[0].name, extra, id]
  );
  res.json(rows[0]);
}));

module.exports = router;
