const express = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/asyncHandler');
const { accountBalance } = require('../services/accounting');

const router = express.Router();

router.get('/ledger/:accountId', asyncHandler(async (req, res) => {
  const { accountId } = req.params;
  const { from, to } = req.query;
  const { rows: accountRows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
  const account = accountRows[0];
  const params = [accountId];
  let where = 'jl.account_id = $1';
  if (from) { params.push(from); where += ` AND je.entry_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND je.entry_date <= $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT je.entry_date, je.description, jl.debit, jl.credit
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE ${where} ORDER BY je.entry_date, je.created_at`,
    params
  );
  const isDebitNormal = ['asset', 'expense'].includes(account?.type);
  let running = 0;
  const withRunning = rows.map((r) => {
    running += isDebitNormal ? (Number(r.debit) - Number(r.credit)) : (Number(r.credit) - Number(r.debit));
    return { ...r, running };
  });
  res.json({ account, rows: withRunning, closingBalance: running });
}));

router.get('/trial-balance', asyncHandler(async (req, res) => {
  const { asOf } = req.query;
  const { rows: accounts } = await pool.query('SELECT * FROM accounts WHERE is_active ORDER BY code');
  let totalDebit = 0, totalCredit = 0;
  const rows = await Promise.all(accounts.map(async (a) => {
    const { debit, credit } = await accountBalance(pool, { accountId: a.id, asOf: asOf || null });
    const net = debit - credit;
    const debitCol = net > 0 ? net : 0, creditCol = net < 0 ? -net : 0;
    totalDebit += debitCol; totalCredit += creditCol;
    return { code: a.code, name: a.name, debit: debitCol, credit: creditCol };
  }));
  res.json({ rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 });
}));

async function incomeStatement(from, to) {
  const { rows: accounts } = await pool.query("SELECT * FROM accounts WHERE type IN ('revenue','expense') AND is_active ORDER BY code");
  const revRows = [], expRows = [];
  for (const a of accounts) {
    const { debit, credit } = await accountBalance(pool, { accountId: a.id, from, to });
    if (a.type === 'revenue') revRows.push({ name: a.name, amount: credit - debit });
    else expRows.push({ name: a.name, amount: debit - credit });
  }
  const totalRev = revRows.reduce((s, r) => s + r.amount, 0);
  const totalExp = expRows.reduce((s, r) => s + r.amount, 0);
  return { revRows, expRows, totalRev, totalExp, netIncome: totalRev - totalExp };
}

router.get('/income-statement', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  res.json(await incomeStatement(from || null, to || null));
}));

router.get('/balance-sheet', asyncHandler(async (req, res) => {
  const { asOf } = req.query;
  const { rows: accounts } = await pool.query("SELECT * FROM accounts WHERE is_active ORDER BY code");
  const assetRows = [], liabRows = [], eqRows = [];
  for (const a of accounts) {
    const { debit, credit } = await accountBalance(pool, { accountId: a.id, asOf });
    if (a.type === 'asset') assetRows.push({ name: a.name, amount: debit - credit });
    else if (a.type === 'liability') liabRows.push({ name: a.name, amount: credit - debit });
    else if (a.type === 'equity') eqRows.push({ name: a.name, amount: credit - debit });
  }
  const totalAssets = assetRows.reduce((s, r) => s + r.amount, 0);
  const totalLiab = liabRows.reduce((s, r) => s + r.amount, 0);
  const totalEqAccounts = eqRows.reduce((s, r) => s + r.amount, 0);
  const netIncomeToDate = (await incomeStatement(null, asOf)).netIncome;
  const totalEquity = totalEqAccounts + netIncomeToDate;
  res.json({
    assetRows, liabRows, eqRows, totalAssets, totalLiab, totalEquity, netIncomeToDate,
    balanced: Math.abs(totalAssets - (totalLiab + totalEquity)) < 0.01,
  });
}));

router.get('/cash-flow', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const { rows: cashAccounts } = await pool.query("SELECT id FROM accounts WHERE code IN ('1000','1010')");
  const dayBefore = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return x.toISOString().slice(0, 10); };

  async function cashTotal(asOf) {
    let sum = 0;
    for (const c of cashAccounts) {
      const { debit, credit } = await accountBalance(pool, { accountId: c.id, asOf });
      sum += debit - credit;
    }
    return sum;
  }
  const opening = await cashTotal(dayBefore(from));
  const closing = await cashTotal(to);
  const netIncome = (await incomeStatement(from, to)).netIncome;

  async function categoryRows(cat) {
    const { rows: accounts } = await pool.query(
      "SELECT * FROM accounts WHERE cash_flow_category = $1 AND type NOT IN ('revenue','expense') AND code NOT IN ('1000','1010','3100') AND is_active",
      [cat]
    );
    const out = [];
    for (const a of accounts) {
      const openBal = await accountBalance(pool, { accountId: a.id, asOf: dayBefore(from) });
      const closeBal = await accountBalance(pool, { accountId: a.id, asOf: to });
      const isDebitNormal = a.type === 'asset';
      const openNet = isDebitNormal ? openBal.debit - openBal.credit : openBal.credit - openBal.debit;
      const closeNet = isDebitNormal ? closeBal.debit - closeBal.credit : closeBal.credit - closeBal.debit;
      const delta = closeNet - openNet;
      out.push({ name: a.name, amount: isDebitNormal ? -delta : delta });
    }
    return out;
  }
  const cfoRows = await categoryRows('operating');
  const cfoTotal = cfoRows.reduce((s, r) => s + r.amount, 0) + netIncome;
  const cfiRows = await categoryRows('investing');
  const cfiTotal = cfiRows.reduce((s, r) => s + r.amount, 0);
  const cffRows = await categoryRows('financing');
  const cffTotal = cffRows.reduce((s, r) => s + r.amount, 0);
  const netChange = cfoTotal + cfiTotal + cffTotal;
  res.json({ opening, closing, netIncome, cfoRows, cfoTotal, cfiRows, cfiTotal, cffRows, cffTotal, netChange });
}));

router.get('/equity-statement', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const { rows: eqAccounts } = await pool.query("SELECT * FROM accounts WHERE type = 'equity' AND is_active ORDER BY code");
  const dayBefore = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return x.toISOString().slice(0, 10); };
  const rows = [];
  for (const a of eqAccounts) {
    const openBal = await accountBalance(pool, { accountId: a.id, asOf: dayBefore(from) });
    const closeBal = await accountBalance(pool, { accountId: a.id, asOf: to });
    const opening = openBal.credit - openBal.debit;
    const closing = closeBal.credit - closeBal.debit;
    rows.push({ name: a.name, opening, movement: closing - opening, closing });
  }
  const netIncome = (await incomeStatement(from, to)).netIncome;
  const totalOpening = rows.reduce((s, r) => s + r.opening, 0);
  const totalClosing = rows.reduce((s, r) => s + r.closing, 0) + netIncome;
  res.json({ rows, netIncome, totalOpening, totalClosing });
}));

module.exports = router;
