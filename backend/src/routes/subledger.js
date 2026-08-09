const express = require('express');
const { pool } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { accountBalance } = require('../services/accounting');

const router = express.Router();

// GET /api/subledger/:controlAccountId?asOf=YYYY-MM-DD
router.get('/:controlAccountId', asyncHandler(async (req, res) => {
  const { controlAccountId } = req.params;
  const { asOf } = req.query;
  const { rows: accountRows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [controlAccountId]);
  const account = accountRows[0];
  if (!account || !account.has_subledger) throw new ApiError(404, 'حساب إجمالي غير موجود');

  const { rows: entities } = await pool.query(
    'SELECT * FROM subledger_entities WHERE control_account_id = $1 AND is_active ORDER BY code',
    [controlAccountId]
  );
  const withBalance = await Promise.all(entities.map(async (e) => {
    const { debit, credit } = await accountBalance(pool, { accountId: controlAccountId, asOf: asOf || null, entityId: e.id });
    return { ...e, debit, credit, balance: debit - credit };
  }));
  const sumEntities = withBalance.reduce((s, e) => s + e.balance, 0);
  const control = await accountBalance(pool, { accountId: controlAccountId, asOf: asOf || null });
  const controlBalance = control.debit - control.credit;
  const reconciled = Math.abs(controlBalance - sumEntities) < 0.01;
  res.json({ account, entities: withBalance, sumEntities, controlBalance, reconciled });
}));

router.post('/:controlAccountId', asyncHandler(async (req, res) => {
  const { controlAccountId } = req.params;
  const { code, name, extra } = req.body;
  if (!code || !name) throw new ApiError(400, 'رمز العنصر واسمه مطلوبان');
  const { rows: accountRows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [controlAccountId]);
  if (!accountRows[0] || !accountRows[0].has_subledger) throw new ApiError(404, 'حساب إجمالي غير موجود');
  try {
    const { rows } = await pool.query(
      `INSERT INTO subledger_entities (control_account_id, code, name, extra) VALUES ($1,$2,$3,$4) RETURNING *`,
      [controlAccountId, code, name, extra || {}]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'الرمز مستخدم مسبقاً لهذا الحساب');
    throw err;
  }
}));

router.delete('/entity/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: used } = await pool.query('SELECT 1 FROM journal_lines WHERE entity_id = $1 LIMIT 1', [id]);
  if (used.length) throw new ApiError(409, 'لا يمكن حذف عنصر مرتبط بقيود مسجّلة');
  await pool.query('DELETE FROM subledger_entities WHERE id = $1', [id]);
  res.status(204).end();
}));

module.exports = router;
