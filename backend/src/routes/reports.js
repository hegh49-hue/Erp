const express = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/asyncHandler');
const { accountBalance } = require('../services/accounting');
const { computeBusinessDate } = require('../services/businessDay');

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

// ---------- POS: sales by payment method (netting credit note returns) ----------
router.get('/pos-by-payment', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const { rows } = await pool.query(
    `SELECT inv.pay_method_label, c.name AS cashier_name,
       COUNT(*) FILTER (WHERE inv.doc_type = 'sale') AS sales_count,
       COUNT(*) FILTER (WHERE inv.doc_type = 'credit_note') AS returns_count,
       COALESCE(SUM(CASE WHEN inv.doc_type = 'sale' THEN inv.total ELSE -inv.total END), 0)::numeric AS net_amount
     FROM pos_invoices inv
     JOIN subledger_entities c ON c.id = inv.cashier_id
     WHERE ($1::date IS NULL OR inv.business_date >= $1) AND ($2::date IS NULL OR inv.business_date <= $2)
     GROUP BY inv.pay_method_label, c.name
     ORDER BY inv.pay_method_label, c.name`,
    [from || null, to || null]
  );
  const methodsMap = new Map();
  for (const r of rows) {
    if (!methodsMap.has(r.pay_method_label)) methodsMap.set(r.pay_method_label, { payMethodLabel: r.pay_method_label, salesCount: 0, returnsCount: 0, netAmount: 0, byCashier: [] });
    const m = methodsMap.get(r.pay_method_label);
    m.salesCount += Number(r.sales_count);
    m.returnsCount += Number(r.returns_count);
    m.netAmount += Number(r.net_amount);
    m.byCashier.push({ cashierName: r.cashier_name, salesCount: Number(r.sales_count), returnsCount: Number(r.returns_count), netAmount: Number(r.net_amount) });
  }
  const methods = [...methodsMap.values()];
  const grandTotal = methods.reduce((s, m) => s + m.netAmount, 0);
  const grandSalesCount = methods.reduce((s, m) => s + m.salesCount, 0);
  const grandReturnsCount = methods.reduce((s, m) => s + m.returnsCount, 0);
  res.json({ methods, grandTotal, grandSalesCount, grandReturnsCount });
}));

// ---------- POS: sales by item or category (netting credit note returns) ----------
router.get('/pos-sales-by-item', asyncHandler(async (req, res) => {
  const { from, to, groupBy } = req.query;
  const useCategory = groupBy === 'category';
  const groupExpr = useCategory ? 'i.category' : 'i.id, i.name, i.unit';
  const { rows } = await pool.query(
    `SELECT ${useCategory ? 'i.category AS label' : 'i.id, i.name AS label, i.unit'},
       COALESCE(SUM(CASE WHEN inv.doc_type = 'sale' THEN l.qty ELSE -l.qty END), 0)::numeric AS qty,
       COALESCE(SUM(CASE WHEN inv.doc_type = 'sale' THEN l.qty * l.unit_price ELSE -(l.qty * l.unit_price) END), 0)::numeric AS revenue
     FROM pos_invoice_lines l
     JOIN pos_invoices inv ON inv.id = l.invoice_id
     JOIN items i ON i.id = l.item_id
     WHERE ($1::date IS NULL OR inv.business_date >= $1) AND ($2::date IS NULL OR inv.business_date <= $2)
     GROUP BY ${groupExpr}
     ORDER BY revenue DESC`,
    [from || null, to || null]
  );
  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue), 0);
  const totalQty = rows.reduce((s, r) => s + Number(r.qty), 0);
  const withPct = rows.map((r) => ({
    ...r, qty: Number(r.qty), revenue: Number(r.revenue),
    pct: totalRevenue !== 0 ? (Number(r.revenue) / totalRevenue) * 100 : 0,
  }));
  res.json({ rows: withPct, totalRevenue, totalQty });
}));

// ---------- POS: end-of-day closing report for a single business day ----------
router.get('/pos-daily-closing', asyncHandler(async (req, res) => {
  let { businessDate } = req.query;
  if (!businessDate) {
    const { rows: companyRows } = await pool.query('SELECT business_day_start_hour FROM companies ORDER BY created_at LIMIT 1');
    businessDate = computeBusinessDate(new Date(), companyRows[0]?.business_day_start_hour ?? 6);
  }

  const { rows: totals } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN doc_type = 'sale' THEN subtotal ELSE 0 END), 0)::numeric AS subtotal,
       COALESCE(SUM(CASE WHEN doc_type = 'sale' THEN vat ELSE 0 END), 0)::numeric AS vat,
       COALESCE(SUM(CASE WHEN doc_type = 'sale' THEN total ELSE 0 END), 0)::numeric AS total,
       COUNT(*) FILTER (WHERE doc_type = 'sale') AS invoice_count,
       COUNT(*) FILTER (WHERE doc_type = 'credit_note') AS returns_count,
       COALESCE(SUM(CASE WHEN doc_type = 'credit_note' THEN total ELSE 0 END), 0)::numeric AS returns_total
     FROM pos_invoices WHERE business_date = $1`,
    [businessDate]
  );
  const t = totals[0];
  const netTotal = Number(t.total) - Number(t.returns_total);

  const { rows: byPaymentMethod } = await pool.query(
    `SELECT pay_method_label,
       COALESCE(SUM(CASE WHEN doc_type = 'sale' THEN total ELSE -total END), 0)::numeric AS net_amount,
       COUNT(*) FILTER (WHERE doc_type = 'sale') AS sales_count,
       COUNT(*) FILTER (WHERE doc_type = 'credit_note') AS returns_count
     FROM pos_invoices WHERE business_date = $1
     GROUP BY pay_method_label ORDER BY pay_method_label`,
    [businessDate]
  );

  const { rows: topItems } = await pool.query(
    `SELECT i.name,
       COALESCE(SUM(CASE WHEN inv.doc_type = 'sale' THEN l.qty ELSE -l.qty END), 0)::numeric AS qty,
       COALESCE(SUM(CASE WHEN inv.doc_type = 'sale' THEN l.qty * l.unit_price ELSE -(l.qty * l.unit_price) END), 0)::numeric AS revenue
     FROM pos_invoice_lines l
     JOIN pos_invoices inv ON inv.id = l.invoice_id
     JOIN items i ON i.id = l.item_id
     WHERE inv.business_date = $1
     GROUP BY i.id, i.name
     ORDER BY revenue DESC LIMIT 5`,
    [businessDate]
  );

  res.json({
    businessDate,
    subtotal: Number(t.subtotal), vat: Number(t.vat), total: Number(t.total), invoiceCount: Number(t.invoice_count),
    returnsCount: Number(t.returns_count), returnsTotal: Number(t.returns_total), netTotal,
    byPaymentMethod: byPaymentMethod.map((r) => ({ payMethodLabel: r.pay_method_label, netAmount: Number(r.net_amount), salesCount: Number(r.sales_count), returnsCount: Number(r.returns_count) })),
    topItems: topItems.map((r) => ({ name: r.name, qty: Number(r.qty), revenue: Number(r.revenue) })),
  });
}));

// ---------- Cashier control/audit report: surfaces signals that may indicate manipulation ----------
const RETURN_RATIO_FLAG = 0.15; // 15% of sales value returned by the same cashier is worth a look
router.get('/cashier-control', asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  const { rows: cashiers } = await pool.query(
    `SELECT se.id, se.name FROM subledger_entities se
     JOIN accounts a ON a.id = se.control_account_id
     WHERE a.code = '1000' AND se.is_active ORDER BY se.name`
  );

  const { rows: invoiceAgg } = await pool.query(
    `SELECT cashier_id,
       COUNT(*) FILTER (WHERE doc_type = 'sale') AS sales_count,
       COALESCE(SUM(total) FILTER (WHERE doc_type = 'sale'), 0)::numeric AS sales_total,
       COUNT(*) FILTER (WHERE doc_type = 'credit_note') AS returns_count,
       COALESCE(SUM(total) FILTER (WHERE doc_type = 'credit_note'), 0)::numeric AS returns_total,
       COALESCE(SUM(loyalty_discount) FILTER (WHERE doc_type = 'sale'), 0)::numeric AS loyalty_discount_total,
       COUNT(*) FILTER (WHERE doc_type = 'sale' AND pay_method_label = 'آجل — عميل') AS credit_sales_count,
       COALESCE(SUM(total) FILTER (WHERE doc_type = 'sale' AND pay_method_label = 'آجل — عميل'), 0)::numeric AS credit_sales_total
     FROM pos_invoices
     WHERE ($1::date IS NULL OR business_date >= $1) AND ($2::date IS NULL OR business_date <= $2)
     GROUP BY cashier_id`,
    [from || null, to || null]
  );

  const { rows: disbAgg } = await pool.query(
    `SELECT cashier_id,
       COUNT(*) FILTER (WHERE status = 'approved') AS disb_approved_count,
       COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::numeric AS disb_approved_total,
       COUNT(*) FILTER (WHERE status = 'rejected') AS disb_rejected_count,
       COUNT(*) FILTER (WHERE status = 'pending') AS disb_pending_count
     FROM cash_disbursements
     WHERE ($1::date IS NULL OR requested_at::date >= $1) AND ($2::date IS NULL OR requested_at::date <= $2)
     GROUP BY cashier_id`,
    [from || null, to || null]
  );

  const { rows: shiftAgg } = await pool.query(
    `SELECT cashier_id,
       COUNT(*) AS shifts_count,
       COALESCE(SUM(variance), 0)::numeric AS cash_variance_total,
       COALESCE(SUM(CASE WHEN variance < 0 THEN variance ELSE 0 END), 0)::numeric AS cash_shortage_total,
       COUNT(*) FILTER (WHERE variance <> 0) AS cash_variance_flags,
       COALESCE(SUM(network_variance), 0)::numeric AS network_variance_total,
       COUNT(*) FILTER (WHERE network_variance <> 0) AS network_variance_flags
     FROM cashier_shifts
     WHERE status = 'closed' AND ($1::date IS NULL OR business_date >= $1) AND ($2::date IS NULL OR business_date <= $2)
     GROUP BY cashier_id`,
    [from || null, to || null]
  );

  const invById = new Map(invoiceAgg.map((r) => [r.cashier_id, r]));
  const disbById = new Map(disbAgg.map((r) => [r.cashier_id, r]));
  const shiftById = new Map(shiftAgg.map((r) => [r.cashier_id, r]));

  const rows = cashiers.map((c) => {
    const inv = invById.get(c.id) || {};
    const disb = disbById.get(c.id) || {};
    const shift = shiftById.get(c.id) || {};
    const salesTotal = Number(inv.sales_total || 0);
    const returnsTotal = Number(inv.returns_total || 0);
    const returnRatio = salesTotal > 0 ? returnsTotal / salesTotal : 0;
    const cashShortageTotal = Number(shift.cash_shortage_total || 0);
    const flags = [];
    if (returnRatio > RETURN_RATIO_FLAG) flags.push(`نسبة مرتجعات مرتفعة (${(returnRatio * 100).toFixed(0)}%)`);
    if (cashShortageTotal < 0) flags.push(`عجز نقدي متراكم (${cashShortageTotal.toFixed(2)} ر.س)`);
    if (Number(disb.disb_rejected_count || 0) > 0) flags.push(`${disb.disb_rejected_count} طلب صرف مرفوض`);
    if (Number(shift.network_variance_flags || 0) > 0) flags.push(`${shift.network_variance_flags} فرق في الشبكة`);

    return {
      cashierId: c.id,
      cashierName: c.name,
      salesCount: Number(inv.sales_count || 0),
      salesTotal,
      returnsCount: Number(inv.returns_count || 0),
      returnsTotal,
      returnRatioPct: returnRatio * 100,
      loyaltyDiscountTotal: Number(inv.loyalty_discount_total || 0),
      creditSalesCount: Number(inv.credit_sales_count || 0),
      creditSalesTotal: Number(inv.credit_sales_total || 0),
      disbApprovedCount: Number(disb.disb_approved_count || 0),
      disbApprovedTotal: Number(disb.disb_approved_total || 0),
      disbRejectedCount: Number(disb.disb_rejected_count || 0),
      disbPendingCount: Number(disb.disb_pending_count || 0),
      shiftsCount: Number(shift.shifts_count || 0),
      cashVarianceTotal: Number(shift.cash_variance_total || 0),
      cashShortageTotal,
      cashVarianceFlags: Number(shift.cash_variance_flags || 0),
      networkVarianceTotal: Number(shift.network_variance_total || 0),
      networkVarianceFlags: Number(shift.network_variance_flags || 0),
      flags,
    };
  });

  res.json({ from: from || null, to: to || null, rows });
}));

// ---------- Cashier control report: chronological drill-down for one cashier ----------
router.get('/cashier-control/:cashierId/timeline', asyncHandler(async (req, res) => {
  const { cashierId } = req.params;
  const { from, to } = req.query;

  const { rows: returns } = await pool.query(
    `SELECT inv.id, inv.issued_at AS at, inv.number, inv.total, orig.number AS original_number
     FROM pos_invoices inv LEFT JOIN pos_invoices orig ON orig.id = inv.original_invoice_id
     WHERE inv.cashier_id = $1 AND inv.doc_type = 'credit_note'
       AND ($2::date IS NULL OR inv.business_date >= $2) AND ($3::date IS NULL OR inv.business_date <= $3)`,
    [cashierId, from || null, to || null]
  );
  const { rows: disbursements } = await pool.query(
    `SELECT id, requested_at AS at, amount, description, status, rejection_reason
     FROM cash_disbursements
     WHERE cashier_id = $1
       AND ($2::date IS NULL OR requested_at::date >= $2) AND ($3::date IS NULL OR requested_at::date <= $3)`,
    [cashierId, from || null, to || null]
  );
  const { rows: shifts } = await pool.query(
    `SELECT id, closed_at AS at, opening_float, counted_amount, expected_amount, variance, network_counted, network_expected, network_variance
     FROM cashier_shifts
     WHERE cashier_id = $1 AND status = 'closed'
       AND ($2::date IS NULL OR business_date >= $2) AND ($3::date IS NULL OR business_date <= $3)`,
    [cashierId, from || null, to || null]
  );

  const events = [
    ...returns.map((r) => ({
      type: 'return', at: r.at,
      description: `مردود بقيمة ${Number(r.total).toFixed(2)} ر.س على الفاتورة #${r.original_number || '—'} (مردود #${r.number})`,
    })),
    ...disbursements.map((d) => ({
      type: 'disbursement', at: d.at,
      description: `طلب صرف ${Number(d.amount).toFixed(2)} ر.س — ${d.description}${d.status === 'rejected' ? ` (مرفوض: ${d.rejection_reason || ''})` : ` (${d.status === 'approved' ? 'معتمد' : 'معلّق'})`}`,
    })),
    ...shifts.map((s) => ({
      type: 'shift_close', at: s.at,
      description: `إغلاق شفت — فرق نقدي ${Number(s.variance).toFixed(2)} ر.س، فرق شبكة ${Number(s.network_variance).toFixed(2)} ر.س`,
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  res.json({ events });
}));

module.exports = router;
