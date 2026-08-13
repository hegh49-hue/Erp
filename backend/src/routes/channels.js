const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { postJournalEntry, accountBalance } = require('../services/accounting');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const reviewerOnly = requireRole('admin', 'accountant');

async function getAccountByCode(client, code) {
  const { rows } = await client.query('SELECT * FROM accounts WHERE code = $1', [code]);
  if (!rows[0]) throw new ApiError(500, `حساب أساسي مفقود: ${code}`);
  return rows[0];
}

router.get('/', asyncHandler(async (req, res) => {
  const channelAccount = await getAccountByCode(pool, '1150');
  const { rows: channels } = await pool.query(
    'SELECT * FROM subledger_entities WHERE control_account_id = $1 AND is_active ORDER BY code',
    [channelAccount.id]
  );
  const withDue = await Promise.all(channels.map(async (c) => {
    const { debit, credit } = await accountBalance(pool, { accountId: channelAccount.id, entityId: c.id });
    return { ...c, due: debit - credit };
  }));
  res.json(withDue);
}));

router.post('/', reviewerOnly, asyncHandler(async (req, res) => {
  const { name, type, commissionPct, settlementCycle } = req.body;
  if (!name) throw new ApiError(400, 'اسم القناة مطلوب');
  const channelAccount = await getAccountByCode(pool, '1150');
  const { rows: existing } = await pool.query(
    'SELECT 1 FROM subledger_entities WHERE control_account_id = $1 AND name = $2',
    [channelAccount.id, name]
  );
  if (existing.length) throw new ApiError(409, 'هذه القناة مسجّلة مسبقاً');
  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM subledger_entities WHERE control_account_id = $1',
    [channelAccount.id]
  );
  const code = `CH-${countRows[0].n + 1}`;
  const { rows } = await pool.query(
    `INSERT INTO subledger_entities (control_account_id, code, name, extra) VALUES ($1,$2,$3,$4) RETURNING *`,
    [channelAccount.id, code, name, { type, commissionPct: Number(commissionPct) || 0, settlementCycle }]
  );
  res.status(201).json(rows[0]);
}));

router.post('/:id/settle', reviewerOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await withTransaction(async (client) => {
    const channelAccount = await getAccountByCode(client, '1150');
    const bankAccount = await getAccountByCode(client, '1010');
    const commissionAccount = await getAccountByCode(client, '5150');
    const { rows: chRows } = await client.query('SELECT * FROM subledger_entities WHERE id = $1', [id]);
    const channel = chRows[0];
    if (!channel) throw new ApiError(404, 'قناة غير موجودة');
    const { debit, credit } = await accountBalance(client, { accountId: channelAccount.id, entityId: id });
    const due = debit - credit;
    if (due <= 0) throw new ApiError(400, 'لا يوجد رصيد مستحق لهذه القناة');
    const commissionPct = Number(channel.extra?.commissionPct) || 0;
    const commission = Math.round(due * commissionPct) / 100;
    const net = due - commission;
    const entry = await postJournalEntry(client, {
      entryDate: new Date().toISOString().slice(0, 10),
      description: `تسوية قناة خارجية - ${channel.name}`,
      reference: channel.code,
      sourceType: 'channel_settlement',
      sourceId: channel.id,
      createdBy: req.user.id,
      lines: [
        { accountId: bankAccount.id, debit: net, credit: 0 },
        { accountId: commissionAccount.id, debit: commission, credit: 0 },
        { accountId: channelAccount.id, debit: 0, credit: due, entityId: id },
      ],
    });
    return { due, commission, net, entry };
  });
  res.json(result);
}));

module.exports = router;
