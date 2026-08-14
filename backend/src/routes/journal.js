const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { postJournalEntry } = require('../services/accounting');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { rows: entries } = await pool.query('SELECT * FROM journal_entries ORDER BY entry_date DESC, created_at DESC');
  const { rows: lines } = await pool.query(
    `SELECT jl.*, a.code AS account_code, a.name AS account_name, e.name AS entity_name, e.code AS entity_code
     FROM journal_lines jl
     JOIN accounts a ON a.id = jl.account_id
     LEFT JOIN subledger_entities e ON e.id = jl.entity_id
     ORDER BY jl.line_no`
  );
  const linesByEntry = new Map();
  for (const l of lines) {
    if (!linesByEntry.has(l.entry_id)) linesByEntry.set(l.entry_id, []);
    linesByEntry.get(l.entry_id).push(l);
  }
  res.json(entries.map((e) => ({ ...e, lines: linesByEntry.get(e.id) || [] })));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { entryDate, description, reference, lines } = req.body;
  const entry = await withTransaction((client) =>
    postJournalEntry(client, {
      entryDate, description, reference, sourceType: 'manual', createdBy: req.user.id, lines,
    })
  );
  res.status(201).json(entry);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT source_type FROM journal_entries WHERE id = $1', [id]);
  if (!rows[0]) throw new ApiError(404, 'قيد غير موجود');
  if (rows[0].source_type !== 'manual') throw new ApiError(409, 'لا يمكن حذف قيد تلقائي من هنا — احذف المستند المصدر بدلاً منه');
  await pool.query('DELETE FROM journal_entries WHERE id = $1', [id]);
  res.status(204).end();
}));

module.exports = router;
