const express = require('express');
const { pool } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = 'TRUE';
  if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT r.*, rb.full_name AS requested_by_name, ub.full_name AS updated_by_name
     FROM purchase_requests r
     LEFT JOIN users rb ON rb.id = r.requested_by
     LEFT JOIN users ub ON ub.id = r.updated_by
     WHERE ${where} ORDER BY r.requested_at DESC`,
    params
  );
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { description, approxQty, note } = req.body;
  if (req.user.role === 'accountant') throw new ApiError(403, 'لا تملك صلاحية إنشاء طلب شراء');
  if (!description) throw new ApiError(400, 'وصف الصنف المطلوب إلزامي');
  const { rows } = await pool.query(
    `INSERT INTO purchase_requests (description, approx_qty, note, requested_by) VALUES ($1,$2,$3,$4) RETURNING *`,
    [description, approxQty || null, note || null, req.user.id]
  );
  res.status(201).json(rows[0]);
}));

router.put('/:id/status', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['requested', 'fulfilled', 'cancelled'].includes(status)) throw new ApiError(400, 'حالة غير صالحة');
  const { rows } = await pool.query(
    `UPDATE purchase_requests SET status=$1, updated_by=$2, updated_at=now() WHERE id=$3 RETURNING *`,
    [status, req.user.id, id]
  );
  if (!rows[0]) throw new ApiError(404, 'طلب غير موجود');
  res.json(rows[0]);
}));

module.exports = router;
