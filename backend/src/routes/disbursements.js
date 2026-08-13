const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { postJournalEntry } = require('../services/accounting');
const { getAccountByCode } = require('../services/inventory');
const { computeBusinessDate } = require('../services/businessDay');

const router = express.Router();
const reviewerOnly = requireRole('admin', 'accountant');

router.get('/', reviewerOnly, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = 'TRUE';
  if (status) { params.push(status); where += ` AND d.status = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT d.*, c.name AS cashier_name, rb.full_name AS requested_by_name, ea.code AS expense_account_code, ea.name AS expense_account_name
     FROM cash_disbursements d
     JOIN subledger_entities c ON c.id = d.cashier_id
     LEFT JOIN users rb ON rb.id = d.requested_by
     LEFT JOIN accounts ea ON ea.id = d.expense_account_id
     WHERE ${where} ORDER BY d.requested_at DESC`,
    params
  );
  res.json(rows);
}));

router.get('/mine/:cashierId', asyncHandler(async (req, res) => {
  const { cashierId } = req.params;
  if (req.user.role === 'cashier' && cashierId !== req.user.cashierEntityId) {
    throw new ApiError(403, 'لا يمكنك عرض طلبات كاشير آخر');
  }
  const { rows } = await pool.query(
    `SELECT d.*, ea.code AS expense_account_code, ea.name AS expense_account_name
     FROM cash_disbursements d LEFT JOIN accounts ea ON ea.id = d.expense_account_id
     WHERE d.cashier_id = $1 ORDER BY d.requested_at DESC`,
    [cashierId]
  );
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { cashierId, amount, description, receiptAttachment } = req.body;
  if (req.user.role === 'accountant') throw new ApiError(403, 'لا تملك صلاحية إنشاء طلب صرف');
  if (!cashierId) throw new ApiError(400, 'يرجى اختيار الكاشير');
  if (req.user.role === 'cashier' && cashierId !== req.user.cashierEntityId) throw new ApiError(403, 'لا يمكنك الصرف إلا من صندوقك الخاص');
  const amt = Number(amount);
  if (!(amt > 0)) throw new ApiError(400, 'المبلغ يجب أن يكون أكبر من صفر');
  if (!description) throw new ApiError(400, 'وصف الصرف مطلوب');
  const { rows } = await pool.query(
    `INSERT INTO cash_disbursements (cashier_id, amount, description, receipt_attachment, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [cashierId, amt, description, receiptAttachment || null, req.user.id]
  );
  res.status(201).json(rows[0]);
}));

router.post('/:id/approve', reviewerOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { expenseAccountId } = req.body;
  if (!expenseAccountId) throw new ApiError(400, 'يرجى اختيار حساب المصروف');

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM cash_disbursements WHERE id = $1 FOR UPDATE', [id]);
    const disb = rows[0];
    if (!disb) throw new ApiError(404, 'طلب غير موجود');
    if (disb.status !== 'pending') throw new ApiError(409, 'هذا الطلب تمت معالجته بالفعل');

    const cashAccount = await getAccountByCode(client, '1000');
    const { rows: companyRows } = await client.query('SELECT business_day_start_hour FROM companies ORDER BY created_at LIMIT 1');
    const businessDate = computeBusinessDate(new Date(), companyRows[0]?.business_day_start_hour ?? 6);

    const entry = await postJournalEntry(client, {
      entryDate: businessDate,
      description: `صرف نقدي معتمد — ${disb.description}`,
      sourceType: 'cash_disbursement',
      sourceId: disb.id,
      createdBy: req.user.id,
      lines: [
        { accountId: expenseAccountId, debit: disb.amount, credit: 0 },
        { accountId: cashAccount.id, debit: 0, credit: disb.amount, entityId: disb.cashier_id },
      ],
    });

    const { rows: updated } = await client.query(
      `UPDATE cash_disbursements SET status='approved', expense_account_id=$1, journal_entry_id=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$4 RETURNING *`,
      [expenseAccountId, entry.id, req.user.id, id]
    );
    return updated[0];
  });
  res.json(result);
}));

router.post('/:id/reject', reviewerOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) throw new ApiError(400, 'سبب الرفض مطلوب');
  const { rows } = await pool.query(
    `UPDATE cash_disbursements SET status='rejected', rejection_reason=$1, reviewed_by=$2, reviewed_at=now() WHERE id=$3 AND status='pending' RETURNING *`,
    [reason, req.user.id, id]
  );
  if (!rows[0]) throw new ApiError(409, 'هذا الطلب غير موجود أو تمت معالجته بالفعل');
  res.json(rows[0]);
}));

module.exports = router;
