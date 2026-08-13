const express = require('express');
const { pool } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { buildXlsxBuffer, buildPdfBuffer } = require('../services/export');

const router = express.Router();

function contentDisposition(filename) {
  return `attachment; filename="report.${filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function validatePayload(body) {
  const { title, columns, rows } = body;
  if (!title) throw new ApiError(400, 'عنوان التقرير مطلوب');
  if (!Array.isArray(columns) || columns.length === 0) throw new ApiError(400, 'أعمدة التقرير مطلوبة');
  if (!Array.isArray(rows)) throw new ApiError(400, 'صفوف التقرير مطلوبة');
}

router.post('/xlsx', asyncHandler(async (req, res) => {
  validatePayload(req.body);
  const { title, subtitle, columns, rows } = req.body;
  const buffer = await buildXlsxBuffer({ title, subtitle, columns, rows });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', contentDisposition(`${title}.xlsx`));
  res.send(Buffer.from(buffer));
}));

router.post('/pdf', asyncHandler(async (req, res) => {
  validatePayload(req.body);
  const { title, subtitle, columns, rows } = req.body;
  const { rows: companyRows } = await pool.query('SELECT * FROM companies ORDER BY created_at LIMIT 1');
  const buffer = await buildPdfBuffer({ title, subtitle, columns, rows, company: companyRows[0] });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(`${title}.pdf`));
  res.send(Buffer.from(buffer));
}));

module.exports = router;
