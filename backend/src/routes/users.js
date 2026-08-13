const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { getAccountByCode } = require('../services/inventory');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.cashier_entity_id, c.name AS cashier_name, u.created_at
     FROM users u LEFT JOIN subledger_entities c ON c.id = u.cashier_entity_id
     ORDER BY u.created_at`
  );
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { email, password, fullName, role, cashierName } = req.body;
  if (!email || !password || !fullName || !role) throw new ApiError(400, 'كل الحقول مطلوبة');
  if (!['admin', 'accountant', 'cashier'].includes(role)) throw new ApiError(400, 'دور غير صالح');
  if (password.length < 8) throw new ApiError(400, 'كلمة المرور يجب ألا تقل عن 8 أحرف');

  let cashierEntityId = null;
  if (role === 'cashier') {
    const cashAccount = await getAccountByCode(pool, '1000');
    const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS n FROM subledger_entities WHERE control_account_id = $1', [cashAccount.id]);
    const code = `CSH-${countRows[0].n + 1}`;
    const { rows: entityRows } = await pool.query(
      `INSERT INTO subledger_entities (control_account_id, code, name) VALUES ($1,$2,$3) RETURNING *`,
      [cashAccount.id, code, cashierName?.trim() || fullName]
    );
    cashierEntityId = entityRows[0].id;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, cashier_entity_id) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, email, full_name, role, is_active, cashier_entity_id, created_at`,
      [email, passwordHash, fullName, role, cashierEntityId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'البريد الإلكتروني مستخدم مسبقاً');
    throw err;
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { fullName, role, isActive, newPassword } = req.body;
  if (role && !['admin', 'accountant', 'cashier'].includes(role)) throw new ApiError(400, 'دور غير صالح');

  const { rows: existing } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  if (!existing[0]) throw new ApiError(404, 'المستخدم غير موجود');

  let passwordHash = existing[0].password_hash;
  if (newPassword) {
    if (newPassword.length < 8) throw new ApiError(400, 'كلمة المرور يجب ألا تقل عن 8 أحرف');
    passwordHash = await bcrypt.hash(newPassword, 10);
  }
  const { rows } = await pool.query(
    `UPDATE users SET full_name = $1, role = COALESCE($2, role), is_active = $3, password_hash = $4 WHERE id = $5
     RETURNING id, email, full_name, role, is_active, cashier_entity_id, created_at`,
    [fullName ?? existing[0].full_name, role || null, isActive !== undefined ? !!isActive : existing[0].is_active, passwordHash, id]
  );
  res.json(rows[0]);
}));

module.exports = router;
