const express = require('express');
const { pool } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { accountBalance } = require('../services/accounting');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { asOf } = req.query;
  const { rows: accounts } = await pool.query('SELECT * FROM accounts WHERE is_active ORDER BY code');
  const withBalance = await Promise.all(accounts.map(async (a) => {
    const { debit, credit } = await accountBalance(pool, { accountId: a.id, asOf: asOf || null });
    return { ...a, debit, credit, balance: debit - credit };
  }));
  res.json(withBalance);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { code, name, type, hasSubledger, subledgerType, cashFlowCategory, equityMoveType } = req.body;
  if (!code || !name || !type) throw new ApiError(400, 'رقم الحساب والاسم والنوع مطلوبة');
  if (hasSubledger && !subledgerType) throw new ApiError(400, 'يجب تحديد نوع العنصر التحليلي');
  try {
    const { rows } = await pool.query(
      `INSERT INTO accounts (code, name, type, has_subledger, subledger_type, cash_flow_category, equity_move_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [code, name, type, !!hasSubledger, hasSubledger ? subledgerType : null, cashFlowCategory || 'operating', type === 'equity' ? (equityMoveType || null) : null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'رقم الحساب مستخدم مسبقاً');
    throw err;
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: used } = await pool.query('SELECT 1 FROM journal_lines WHERE account_id = $1 LIMIT 1', [id]);
  if (used.length) throw new ApiError(409, 'لا يمكن حذف حساب مرتبط بقيود مسجّلة');
  await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  res.status(204).end();
}));

module.exports = router;
