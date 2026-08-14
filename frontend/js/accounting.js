const TYPE_LABELS = { asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات' };
const SUBLEDGER_LABELS = { customer: 'عملاء', supplier: 'موردين', warehouse: 'مخازن', cashbox: 'صناديق', asset: 'أصول ثابتة', employee: 'موظفين', channel: 'قنوات خارجية' };
let activeFs = 'income';
let cachedAccounts = [];

async function loadAccounts() {
  cachedAccounts = await Api.get('/accounts');
  return cachedAccounts;
}

// ---------- Chart of accounts ----------
document.getElementById('accHasSub').addEventListener('change', (e) => {
  document.getElementById('accSubTypeWrap').style.display = e.target.checked ? 'block' : 'none';
});
document.getElementById('addAccountBtn').onclick = async () => {
  const code = document.getElementById('accCode').value.trim();
  const name = document.getElementById('accName').value.trim();
  const type = document.getElementById('accType').value;
  const hasSubledger = document.getElementById('accHasSub').checked;
  const subledgerType = document.getElementById('accSubType').value;
  const cashFlowCategory = document.getElementById('accCashFlow').value;
  if (!code || !name) { alert('يرجى إدخال رقم الحساب واسمه'); return; }
  try {
    await Api.post('/accounts', { code, name, type, hasSubledger, subledgerType, cashFlowCategory });
    document.getElementById('accCode').value = ''; document.getElementById('accName').value = '';
    document.getElementById('accHasSub').checked = false; document.getElementById('accSubTypeWrap').style.display = 'none';
    renderAccountsTable();
  } catch (err) { alert(err.message); }
};

async function renderAccountsTable() {
  const body = document.getElementById('accountsBody');
  body.innerHTML = '<tr><td colspan="6" class="empty-note">جارٍ التحميل...</td></tr>';
  const accounts = await loadAccounts();
  body.innerHTML = '';
  accounts.forEach((acc) => {
    const net = acc.balance;
    const balStr = net >= 0 ? `${money(net)} مدين` : `${money(-net)} دائن`;
    const subBadge = acc.has_subledger ? `<span class="mono" style="color:var(--blue); font-size:11px;">${SUBLEDGER_LABELS[acc.subledger_type]}</span>` : '<span style="color:var(--muted); font-size:11px;">—</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mono">${escapeHtml(acc.code)}</td><td>${escapeHtml(acc.name)}</td><td>${TYPE_LABELS[acc.type]}</td><td>${subBadge}</td><td class="mono">${balStr}</td>
      <td><button class="del-entry" data-id="${acc.id}">حذف</button></td>`;
    tr.querySelector('button').onclick = async () => {
      if (!confirm('حذف هذا الحساب؟')) return;
      try { await Api.del('/accounts/' + acc.id); renderAccountsTable(); } catch (err) { alert(err.message); }
    };
    body.appendChild(tr);
  });
}

// ---------- Subledger ----------
async function populateSubAccSelect() {
  const accounts = await loadAccounts();
  const sel = document.getElementById('subAccSelect');
  const cur = sel.value;
  const accs = accounts.filter((a) => a.has_subledger);
  sel.innerHTML = accs.map((a) => `<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${escapeHtml(a.code)} - ${escapeHtml(a.name)} (${SUBLEDGER_LABELS[a.subledger_type]})</option>`).join('') || '<option value="">لا يوجد حسابات إجمالية معرّفة</option>';
  renderSubledger();
}
document.getElementById('subAccSelect').addEventListener('change', renderSubledger);
document.getElementById('addSubEntityBtn').onclick = async () => {
  const accId = document.getElementById('subAccSelect').value;
  const code = document.getElementById('subEntCode').value.trim();
  const name = document.getElementById('subEntName').value.trim();
  if (!accId) { alert('أنشئ أولاً حساباً إجمالياً له عناصر تحليلية'); return; }
  if (!code || !name) { alert('يرجى إدخال رمز العنصر واسمه'); return; }
  try {
    await Api.post('/subledger/' + accId, { code, name });
    document.getElementById('subEntCode').value = ''; document.getElementById('subEntName').value = '';
    renderSubledger();
  } catch (err) { alert(err.message); }
};
async function renderSubledger() {
  const accId = document.getElementById('subAccSelect').value;
  const out = document.getElementById('subledgerOutput');
  if (!accId) { out.innerHTML = '<div class="empty-note">أنشئ حساباً إجمالياً (مفعّل عليه "تحليل فرعي") من شجرة الحسابات أولاً</div>'; return; }
  const data = await Api.get('/subledger/' + accId);
  const rows = data.entities.map((ent) => {
    const net = ent.balance;
    const balStr = net >= 0 ? `${money(net)} مدين` : `${money(-net)} دائن`;
    return `<tr><td class="mono">${escapeHtml(ent.code)}</td><td>${escapeHtml(ent.name)}</td><td class="mono">${balStr}</td>
      <td><button class="del-entry" data-id="${ent.id}">حذف</button></td></tr>`;
  }).join('');
  out.innerHTML = `
    <table><thead><tr><th>الرمز</th><th>اسم العنصر</th><th>الرصيد</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="empty-note">لا توجد عناصر تحليلية بعد لهذا الحساب</td></tr>'}</tbody></table>
    <div class="stat-cards">
      <div class="stat-card"><div class="label">مجموع أرصدة العناصر التحليلية</div><div class="value mono">${money(Math.abs(data.sumEntities))}</div></div>
      <div class="stat-card"><div class="label">رصيد الحساب الإجمالي</div><div class="value mono">${money(Math.abs(data.controlBalance))}</div></div>
    </div>
    <div class="balance-flag ${data.reconciled ? 'ok' : 'bad'}">${data.reconciled ? '✓ مطابق تماماً — لا فروقات' : '⚠ يوجد فرق بين مجموع العناصر والحساب الإجمالي'}</div>`;
  out.querySelectorAll('.del-entry').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('حذف هذا العنصر التحليلي؟')) return;
      try { await Api.del('/subledger/entity/' + btn.dataset.id); renderSubledger(); } catch (err) { alert(err.message); }
    };
  });
}

// ---------- Journal entries ----------
let currentLines = [];
function newLine() { return { accountId: '', side: 'debit', amount: '', entityId: '' }; }
let journalFormInited = false;
function resetJournalFormIfNeeded() {
  if (journalFormInited) return;
  journalFormInited = true;
  document.getElementById('jeDate').value = todayISO();
  currentLines = [newLine(), newLine()];
  renderLines();
}
function accountOptionsHtml(selectedId) {
  return '<option value="">اختر الحساب</option>' + cachedAccounts.map((a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${escapeHtml(a.code)} - ${escapeHtml(a.name)}</option>`).join('');
}
let entityCache = {};
async function entitiesFor(accountId) {
  if (!accountId) return [];
  if (!entityCache[accountId]) {
    const data = await Api.get('/subledger/' + accountId);
    entityCache[accountId] = data.entities;
  }
  return entityCache[accountId];
}
async function renderLines() {
  const container = document.getElementById('linesContainer');
  container.innerHTML = '';
  for (let idx = 0; idx < currentLines.length; idx++) {
    const line = currentLines[idx];
    const acc = cachedAccounts.find((a) => a.id === line.accountId);
    const needsEntity = acc && acc.has_subledger;
    const row = document.createElement('div');
    row.className = 'line-row';
    let entityOptions = '';
    if (needsEntity) {
      const entities = await entitiesFor(line.accountId);
      entityOptions = '<option value="">اختر العنصر التحليلي</option>' + entities.map((e) => `<option value="${e.id}" ${e.id === line.entityId ? 'selected' : ''}>${escapeHtml(e.code)} - ${escapeHtml(e.name)}</option>`).join('');
    }
    row.innerHTML = `
      <select class="acc-select">${accountOptionsHtml(line.accountId)}</select>
      <select class="side-select"><option value="debit" ${line.side === 'debit' ? 'selected' : ''}>مدين</option><option value="credit" ${line.side === 'credit' ? 'selected' : ''}>دائن</option></select>
      <input class="amount-input" type="number" step="0.01" placeholder="0.00" value="${line.amount}">
      ${needsEntity ? `<select class="acc-select entity-select" style="flex:1.6;">${entityOptions}</select>` : ''}
      <button class="remove-line">✕</button>`;
    row.querySelector('.acc-select').onchange = (e) => { currentLines[idx].accountId = e.target.value; currentLines[idx].entityId = ''; renderLines(); };
    row.querySelector('.side-select').onchange = (e) => { currentLines[idx].side = e.target.value; updateJeTotals(); };
    row.querySelector('.amount-input').oninput = (e) => { currentLines[idx].amount = e.target.value; updateJeTotals(); };
    const entSel = row.querySelector('.entity-select');
    if (entSel) entSel.onchange = (e) => { currentLines[idx].entityId = e.target.value; updateJeTotals(); };
    row.querySelector('.remove-line').onclick = () => { currentLines.splice(idx, 1); renderLines(); };
    container.appendChild(row);
  }
  updateJeTotals();
}
document.getElementById('addLineBtn').onclick = () => { currentLines.push(newLine()); renderLines(); };
function updateJeTotals() {
  let sumD = 0, sumC = 0;
  currentLines.forEach((l) => { const amt = parseFloat(l.amount) || 0; if (l.side === 'debit') sumD += amt; else sumC += amt; });
  document.getElementById('jeSumDebit').textContent = sumD.toFixed(2);
  document.getElementById('jeSumCredit').textContent = sumC.toFixed(2);
  const flag = document.getElementById('jeBalanceFlag');
  const amountsBalanced = sumD > 0 && Math.abs(sumD - sumC) < 0.005;
  const missingEntity = currentLines.some((l) => {
    if (!l.accountId || !(parseFloat(l.amount) > 0)) return false;
    const acc = cachedAccounts.find((a) => a.id === l.accountId);
    return acc && acc.has_subledger && !l.entityId;
  });
  const balanced = amountsBalanced && !missingEntity;
  if (missingEntity) { flag.textContent = 'أكمل اختيار العنصر التحليلي لكل سطر'; flag.className = 'balance-bad'; }
  else { flag.textContent = balanced ? '✓ متوازن' : 'غير متوازن'; flag.className = balanced ? 'balance-ok' : 'balance-bad'; }
  document.getElementById('saveEntryBtn').disabled = !balanced;
}
document.getElementById('saveEntryBtn').onclick = async () => {
  const entryDate = document.getElementById('jeDate').value;
  const description = document.getElementById('jeDesc').value.trim();
  const reference = document.getElementById('jeRef').value.trim();
  if (!entryDate || !description) { alert('يرجى إدخال التاريخ وبيان القيد'); return; }
  const lines = currentLines.filter((l) => l.accountId && parseFloat(l.amount) > 0).map((l) => ({
    accountId: l.accountId,
    debit: l.side === 'debit' ? parseFloat(l.amount) : 0,
    credit: l.side === 'credit' ? parseFloat(l.amount) : 0,
    entityId: l.entityId || null,
  }));
  if (lines.length < 2) { alert('يجب أن يحتوي القيد على سطرين على الأقل'); return; }
  try {
    await Api.post('/journal', { entryDate, description, reference, lines });
    document.getElementById('jeDesc').value = ''; document.getElementById('jeRef').value = '';
    currentLines = [newLine(), newLine()];
    renderLines();
    renderEntriesList();
  } catch (err) { alert(err.message); }
};
async function renderEntriesList() {
  const wrap = document.getElementById('entriesList');
  wrap.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const entries = await Api.get('/journal');
  wrap.innerHTML = '';
  if (entries.length === 0) { wrap.innerHTML = '<div class="empty-note">لا توجد قيود مسجّلة بعد</div>'; return; }
  entries.forEach((entry) => {
    const total = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
    const card = document.createElement('div');
    card.className = 'entry-card';
    const linesRows = entry.lines.map((l) => `<tr><td>${escapeHtml(l.account_code)} - ${escapeHtml(l.account_name)}${l.entity_name ? ` <span style="color:var(--muted);">(${escapeHtml(l.entity_name)})</span>` : ''}</td><td class="mono debit-col">${Number(l.debit) ? money(l.debit) : ''}</td><td class="mono credit-col">${Number(l.credit) ? money(l.credit) : ''}</td></tr>`).join('');
    card.innerHTML = `
      <div class="entry-head">
        <div class="eh-left"><span class="eh-date">${entry.entry_date.slice(0, 10)}</span><span class="eh-desc">${escapeHtml(entry.description)}</span>${entry.source_type !== 'manual' ? `<span class="badge">${entry.source_type}</span>` : ''}</div>
        <div style="display:flex; align-items:center; gap:14px;"><span class="eh-total mono">${money(total)}</span>${entry.source_type === 'manual' ? `<button class="del-entry" data-id="${entry.id}">حذف</button>` : ''}</div>
      </div>
      <div class="entry-lines"><table><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${linesRows}</tbody></table></div>`;
    card.querySelector('.entry-head').onclick = (e) => { if (e.target.classList.contains('del-entry')) return; card.querySelector('.entry-lines').classList.toggle('open'); };
    const delBtn = card.querySelector('.del-entry');
    if (delBtn) delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('حذف هذا القيد؟')) return;
      try { await Api.del('/journal/' + entry.id); renderEntriesList(); } catch (err) { alert(err.message); }
    };
    wrap.appendChild(card);
  });
}

// ---------- Ledger ----------
async function populateLedgerAccounts() {
  const accounts = await loadAccounts();
  const sel = document.getElementById('ledgerAccSelect');
  const cur = sel.value;
  sel.innerHTML = accountOptionsHtml(cur);
}
document.getElementById('ledgerAccSelect').addEventListener('change', renderLedger);
document.getElementById('ledgerFrom').addEventListener('change', renderLedger);
document.getElementById('ledgerTo').addEventListener('change', renderLedger);
async function renderLedger() {
  const accId = document.getElementById('ledgerAccSelect').value;
  const out = document.getElementById('ledgerOutput');
  if (!accId) { out.innerHTML = '<div class="empty-note">اختر حساباً لعرض حركاته</div>'; return; }
  const from = document.getElementById('ledgerFrom').value;
  const to = document.getElementById('ledgerTo').value;
  const params = new URLSearchParams(); if (from) params.set('from', from); if (to) params.set('to', to);
  const data = await Api.get(`/reports/ledger/${accId}?${params}`);
  const rowsHtml = data.rows.map((r) => `<tr><td>${r.entry_date.slice(0, 10)}</td><td>${escapeHtml(r.description)}</td><td class="mono debit-col">${Number(r.debit) ? money(r.debit) : ''}</td><td class="mono credit-col">${Number(r.credit) ? money(r.credit) : ''}</td><td class="mono">${money(r.running)}</td></tr>`).join('');
  out.innerHTML = `
    <table><thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد التراكمي</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="5" class="empty-note">لا توجد حركات على هذا الحساب في النطاق المحدد</td></tr>'}</tbody></table>
    <div style="font-weight:800; font-size:15px;">الرصيد الختامي: <span class="mono" style="color:var(--blue);">${money(data.closingBalance)}</span></div>`;
}

// ---------- Trial balance ----------
document.getElementById('trialAsOf').addEventListener('change', renderTrialBalance);
async function renderTrialBalance() {
  if (!document.getElementById('trialAsOf').value) document.getElementById('trialAsOf').value = todayISO();
  const asOf = document.getElementById('trialAsOf').value;
  const out = document.getElementById('trialOutput');
  const data = await Api.get(`/reports/trial-balance?asOf=${asOf}`);
  const rows = data.rows.map((r) => `<tr><td class="mono">${escapeHtml(r.code)}</td><td>${escapeHtml(r.name)}</td><td class="mono debit-col">${r.debit ? money(r.debit) : ''}</td><td class="mono credit-col">${r.credit ? money(r.credit) : ''}</td></tr>`).join('');
  out.innerHTML = `
    <table><thead><tr><th>الرقم</th><th>اسم الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total-row"><td colspan="2">الإجمالي</td><td class="mono">${money(data.totalDebit)}</td><td class="mono">${money(data.totalCredit)}</td></tr></tfoot></table>
    <div class="balance-flag ${data.balanced ? 'ok' : 'bad'}">${data.balanced ? '✓ الميزان متوازن' : '⚠ الميزان غير متوازن'}</div>`;
  renderExportButtons('trialExportBtns', () => ({
    title: 'ميزان المراجعة', subtitle: `حتى تاريخ ${asOf}`,
    columns: [{ key: 'code', label: 'الرقم' }, { key: 'name', label: 'اسم الحساب' }, { key: 'debit', label: 'مدين' }, { key: 'credit', label: 'دائن' }],
    rows: data.rows.map((r) => ({ code: r.code, name: r.name, debit: r.debit.toFixed(2), credit: r.credit.toFixed(2) })),
  }));
}

// ---------- Financial statements ----------
['incFrom', 'incTo', 'balAsOf', 'cfFrom', 'cfTo', 'eqFrom', 'eqTo'].forEach((id) => document.getElementById(id).addEventListener('change', renderStatements));
async function renderStatements() {
  if (!document.getElementById('incFrom').value) {
    const now = new Date();
    document.getElementById('incFrom').value = todayISO(new Date(now.getFullYear(), now.getMonth(), 1));
    document.getElementById('incTo').value = todayISO();
  }
  if (!document.getElementById('balAsOf').value) document.getElementById('balAsOf').value = todayISO();
  if (!document.getElementById('cfFrom').value) { document.getElementById('cfFrom').value = document.getElementById('incFrom').value; document.getElementById('cfTo').value = document.getElementById('incTo').value; }
  if (!document.getElementById('eqFrom').value) { document.getElementById('eqFrom').value = document.getElementById('incFrom').value; document.getElementById('eqTo').value = document.getElementById('incTo').value; }
  const out = document.getElementById('fsOutput');

  if (activeFs === 'cashflow') {
    const from = document.getElementById('cfFrom').value, to = document.getElementById('cfTo').value;
    const r = await Api.get(`/reports/cash-flow?from=${from}&to=${to}`);
    const rowsHtml = (rows) => rows.map((x) => `<div class="fs-row"><span>${escapeHtml(x.name)}</span><span class="mono">${money(x.amount)}</span></div>`).join('') || '<div class="fs-row" style="color:var(--muted);">لا يوجد</div>';
    const checkOk = Math.abs((r.opening + r.netChange) - r.closing) < 0.5;
    out.innerHTML = `<div class="fs-block">
      <h3>قائمة التدفقات النقدية — من ${from} إلى ${to}</h3>
      <div class="fs-row section">الأنشطة التشغيلية</div>
      <div class="fs-row"><span>صافي الدخل للفترة</span><span class="mono">${money(r.netIncome)}</span></div>
      ${rowsHtml(r.cfoRows)}
      <div class="fs-row" style="font-weight:700; border-top:1px dashed var(--line); padding-top:6px;"><span>صافي التدفق من الأنشطة التشغيلية</span><span class="mono">${money(r.cfoTotal)}</span></div>
      <div class="fs-row section">الأنشطة الاستثمارية</div>${rowsHtml(r.cfiRows)}
      <div class="fs-row" style="font-weight:700; border-top:1px dashed var(--line); padding-top:6px;"><span>صافي التدفق من الأنشطة الاستثمارية</span><span class="mono">${money(r.cfiTotal)}</span></div>
      <div class="fs-row section">الأنشطة التمويلية</div>${rowsHtml(r.cffRows)}
      <div class="fs-row" style="font-weight:700; border-top:1px dashed var(--line); padding-top:6px;"><span>صافي التدفق من الأنشطة التمويلية</span><span class="mono">${money(r.cffTotal)}</span></div>
      <div class="fs-row grand"><span>صافي التغير في النقدية</span><span class="mono">${money(r.netChange)}</span></div>
      <div class="fs-row"><span>رصيد النقدية الافتتاحي</span><span class="mono">${money(r.opening)}</span></div>
      <div class="fs-row" style="font-weight:700;"><span>رصيد النقدية الختامي</span><span class="mono">${money(r.closing)}</span></div>
    </div>
    <div class="balance-flag ${checkOk ? 'ok' : 'bad'}" style="max-width:520px;">${checkOk ? '✓ التغير في النقدية يطابق حركة حسابي النقدية والبنك فعلياً' : '⚠ فرق بسيط — راجع تصنيف الحسابات'}</div>`;
    renderExportButtons('fsExportBtns', () => ({
      title: 'قائمة التدفقات النقدية', subtitle: `من ${from} إلى ${to}`,
      columns: [{ key: 'section', label: 'القسم' }, { key: 'name', label: 'البند' }, { key: 'amount', label: 'المبلغ' }],
      rows: [
        ...r.cfoRows.map((x) => ({ section: 'تشغيلية', name: x.name, amount: x.amount.toFixed(2) })),
        { section: 'تشغيلية', name: 'صافي التدفق التشغيلي', amount: r.cfoTotal.toFixed(2) },
        ...r.cfiRows.map((x) => ({ section: 'استثمارية', name: x.name, amount: x.amount.toFixed(2) })),
        { section: 'استثمارية', name: 'صافي التدفق الاستثماري', amount: r.cfiTotal.toFixed(2) },
        ...r.cffRows.map((x) => ({ section: 'تمويلية', name: x.name, amount: x.amount.toFixed(2) })),
        { section: 'تمويلية', name: 'صافي التدفق التمويلي', amount: r.cffTotal.toFixed(2) },
        { section: 'الإجمالي', name: 'صافي التغير في النقدية', amount: r.netChange.toFixed(2) },
        { section: 'الإجمالي', name: 'رصيد النقدية الختامي', amount: r.closing.toFixed(2) },
      ],
    }));
    return;
  }
  if (activeFs === 'equity') {
    const from = document.getElementById('eqFrom').value, to = document.getElementById('eqTo').value;
    const r = await Api.get(`/reports/equity-statement?from=${from}&to=${to}`);
    const rowsHtml = r.rows.map((x) => `<tr><td>${escapeHtml(x.name)}</td><td class="mono">${money(x.opening)}</td><td class="mono">${money(x.movement)}</td><td class="mono">${money(x.closing)}</td></tr>`).join('');
    out.innerHTML = `<div class="fs-block" style="max-width:620px;">
      <h3>قائمة التغيرات في حقوق الملكية — من ${from} إلى ${to}</h3>
      <table style="margin-top:4px;"><thead><tr><th>البند</th><th>رصيد افتتاحي</th><th>الحركة</th><th>رصيد ختامي</th></tr></thead>
      <tbody>${rowsHtml}<tr><td>صافي دخل الفترة الحالية (غير مُقفل بعد)</td><td class="mono">-</td><td class="mono">${money(r.netIncome)}</td><td class="mono">${money(r.netIncome)}</td></tr></tbody>
      <tfoot><tr class="total-row"><td>الإجمالي</td><td class="mono">${money(r.totalOpening)}</td><td class="mono">${money(r.totalClosing - r.totalOpening)}</td><td class="mono">${money(r.totalClosing)}</td></tr></tfoot></table>
    </div>`;
    renderExportButtons('fsExportBtns', () => ({
      title: 'قائمة التغيرات في حقوق الملكية', subtitle: `من ${from} إلى ${to}`,
      columns: [{ key: 'name', label: 'البند' }, { key: 'opening', label: 'رصيد افتتاحي' }, { key: 'movement', label: 'الحركة' }, { key: 'closing', label: 'رصيد ختامي' }],
      rows: [...r.rows.map((x) => ({ name: x.name, opening: x.opening.toFixed(2), movement: x.movement.toFixed(2), closing: x.closing.toFixed(2) })),
        { name: 'صافي دخل الفترة الحالية', opening: '-', movement: r.netIncome.toFixed(2), closing: r.netIncome.toFixed(2) }],
    }));
    return;
  }
  if (activeFs === 'income') {
    const from = document.getElementById('incFrom').value, to = document.getElementById('incTo').value;
    const r = await Api.get(`/reports/income-statement?from=${from}&to=${to}`);
    out.innerHTML = `<div class="fs-block">
      <h3>قائمة الدخل — من ${from} إلى ${to}</h3>
      <div class="fs-row section">الإيرادات</div>
      ${r.revRows.map((x) => `<div class="fs-row"><span>${escapeHtml(x.name)}</span><span class="mono">${money(x.amount)}</span></div>`).join('') || '<div class="fs-row" style="color:var(--muted);">لا توجد بيانات</div>'}
      <div class="fs-row" style="font-weight:700; border-top:1px dashed var(--line); padding-top:6px;"><span>إجمالي الإيرادات</span><span class="mono">${money(r.totalRev)}</span></div>
      <div class="fs-row section">المصروفات</div>
      ${r.expRows.map((x) => `<div class="fs-row"><span>${escapeHtml(x.name)}</span><span class="mono">${money(x.amount)}</span></div>`).join('') || '<div class="fs-row" style="color:var(--muted);">لا توجد بيانات</div>'}
      <div class="fs-row" style="font-weight:700; border-top:1px dashed var(--line); padding-top:6px;"><span>إجمالي المصروفات</span><span class="mono">${money(r.totalExp)}</span></div>
      <div class="fs-row grand"><span>صافي الدخل</span><span class="mono" style="color:${r.netIncome >= 0 ? 'var(--green)' : 'var(--stamp)'};">${money(r.netIncome)}</span></div>
    </div>`;
    renderExportButtons('fsExportBtns', () => ({
      title: 'قائمة الدخل', subtitle: `من ${from} إلى ${to}`,
      columns: [{ key: 'section', label: 'القسم' }, { key: 'name', label: 'البند' }, { key: 'amount', label: 'المبلغ' }],
      rows: [
        ...r.revRows.map((x) => ({ section: 'الإيرادات', name: x.name, amount: x.amount.toFixed(2) })),
        { section: 'الإيرادات', name: 'إجمالي الإيرادات', amount: r.totalRev.toFixed(2) },
        ...r.expRows.map((x) => ({ section: 'المصروفات', name: x.name, amount: x.amount.toFixed(2) })),
        { section: 'المصروفات', name: 'إجمالي المصروفات', amount: r.totalExp.toFixed(2) },
        { section: 'الإجمالي', name: 'صافي الدخل', amount: r.netIncome.toFixed(2) },
      ],
    }));
  } else {
    const asOf = document.getElementById('balAsOf').value;
    const r = await Api.get(`/reports/balance-sheet?asOf=${asOf}`);
    out.innerHTML = `<div class="fs-block">
      <h3>قائمة المركز المالي — كما في ${asOf}</h3>
      <div class="fs-row section">الأصول</div>
      ${r.assetRows.map((x) => `<div class="fs-row"><span>${escapeHtml(x.name)}</span><span class="mono">${money(x.amount)}</span></div>`).join('')}
      <div class="fs-row grand"><span>إجمالي الأصول</span><span class="mono">${money(r.totalAssets)}</span></div>
      <div class="fs-row section" style="margin-top:16px;">الالتزامات</div>
      ${r.liabRows.map((x) => `<div class="fs-row"><span>${escapeHtml(x.name)}</span><span class="mono">${money(x.amount)}</span></div>`).join('')}
      <div class="fs-row" style="font-weight:700; border-top:1px dashed var(--line); padding-top:6px;"><span>إجمالي الالتزامات</span><span class="mono">${money(r.totalLiab)}</span></div>
      <div class="fs-row section">حقوق الملكية</div>
      ${r.eqRows.map((x) => `<div class="fs-row"><span>${escapeHtml(x.name)}</span><span class="mono">${money(x.amount)}</span></div>`).join('')}
      <div class="fs-row"><span>أرباح الفترة الحالية</span><span class="mono">${money(r.netIncomeToDate)}</span></div>
      <div class="fs-row" style="font-weight:700; border-top:1px dashed var(--line); padding-top:6px;"><span>إجمالي حقوق الملكية</span><span class="mono">${money(r.totalEquity)}</span></div>
      <div class="fs-row grand"><span>إجمالي الالتزامات وحقوق الملكية</span><span class="mono">${money(r.totalLiab + r.totalEquity)}</span></div>
    </div>
    <div class="balance-flag ${r.balanced ? 'ok' : 'bad'}" style="max-width:520px;">${r.balanced ? '✓ الميزانية متوازنة' : '⚠ غير متوازنة — راجع القيود'}</div>`;
    renderExportButtons('fsExportBtns', () => ({
      title: 'قائمة المركز المالي', subtitle: `كما في ${asOf}`,
      columns: [{ key: 'section', label: 'القسم' }, { key: 'name', label: 'البند' }, { key: 'amount', label: 'المبلغ' }],
      rows: [
        ...r.assetRows.map((x) => ({ section: 'الأصول', name: x.name, amount: x.amount.toFixed(2) })),
        { section: 'الأصول', name: 'إجمالي الأصول', amount: r.totalAssets.toFixed(2) },
        ...r.liabRows.map((x) => ({ section: 'الالتزامات', name: x.name, amount: x.amount.toFixed(2) })),
        { section: 'الالتزامات', name: 'إجمالي الالتزامات', amount: r.totalLiab.toFixed(2) },
        ...r.eqRows.map((x) => ({ section: 'حقوق الملكية', name: x.name, amount: x.amount.toFixed(2) })),
        { section: 'حقوق الملكية', name: 'إجمالي حقوق الملكية', amount: r.totalEquity.toFixed(2) },
        { section: 'الإجمالي', name: 'إجمالي الالتزامات وحقوق الملكية', amount: (r.totalLiab + r.totalEquity).toFixed(2) },
      ],
    }));
  }
}

// ---------- Cashier control / audit report (detect possible manipulation) ----------
document.getElementById('ccLoadBtn').addEventListener('click', renderCashierControl);
async function renderCashierControl() {
  if (!document.getElementById('ccFrom').value) {
    const now = new Date();
    document.getElementById('ccFrom').value = todayISO(new Date(now.getFullYear(), now.getMonth(), 1));
    document.getElementById('ccTo').value = todayISO();
  }
  const from = document.getElementById('ccFrom').value;
  const to = document.getElementById('ccTo').value;
  const out = document.getElementById('ccSummaryOutput');
  out.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  document.getElementById('ccTimelineWrap').style.display = 'none';
  const data = await Api.get(`/reports/cashier-control?from=${from}&to=${to}`);
  if (data.rows.length === 0) { out.innerHTML = '<div class="empty-note">لا يوجد كاشيرون بعد</div>'; return; }
  const rows = data.rows.map((r) => `
    <tr class="cc-row" data-cashier-id="${r.cashierId}" data-cashier-name="${escapeHtml(r.cashierName)}"
      style="cursor:pointer; ${r.flags.length ? 'background:var(--stamp-soft);' : ''}">
      <td>${escapeHtml(r.cashierName)}</td>
      <td class="mono">${r.salesCount}</td>
      <td class="mono">${money(r.salesTotal)}</td>
      <td class="mono">${r.returnsCount}</td>
      <td class="mono">${money(r.returnsTotal)}</td>
      <td class="mono">${r.returnRatioPct.toFixed(1)}%</td>
      <td class="mono">${money(r.loyaltyDiscountTotal)}</td>
      <td class="mono">${r.creditSalesCount} / ${money(r.creditSalesTotal)}</td>
      <td class="mono">${r.disbApprovedCount} / ${money(r.disbApprovedTotal)}</td>
      <td class="mono">${r.disbRejectedCount}</td>
      <td class="mono">${r.shiftsCount}</td>
      <td class="mono" style="${r.cashVarianceTotal < 0 ? 'color:var(--stamp); font-weight:700;' : ''}">${money(r.cashVarianceTotal)}</td>
      <td class="mono" style="${r.networkVarianceTotal !== 0 ? 'color:var(--stamp); font-weight:700;' : ''}">${money(r.networkVarianceTotal)}</td>
      <td>${r.flags.length ? r.flags.map((f) => `<span class="badge warn" style="display:block; margin:2px 0;">${escapeHtml(f)}</span>`).join('') : '<span class="badge">لا ملاحظات</span>'}</td>
    </tr>`).join('');
  out.innerHTML = `
    <table><thead><tr>
      <th>الكاشير</th><th>عدد المبيعات</th><th>إجمالي المبيعات</th><th>عدد المرتجعات</th><th>إجمالي المرتجعات</th><th>نسبة المرتجعات</th>
      <th>خصم نقاط الولاء</th><th>مبيعات آجلة (عدد/قيمة)</th><th>صرف معتمد (عدد/قيمة)</th><th>صرف مرفوض</th><th>عدد الشفتات</th><th>إجمالي فرق النقدية</th><th>إجمالي فرق الشبكة</th><th>ملاحظات رقابية</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="empty-note" style="margin-top:8px;">انقر على أي صف لعرض السجل التفصيلي لعمليات ذلك الكاشير (مرتجعات، صرفيات، إغلاق شفتات) خلال الفترة المحددة.</div>`;

  out.querySelectorAll('.cc-row').forEach((tr) => {
    tr.addEventListener('click', () => renderCashierControlTimeline(tr.dataset.cashierId, tr.dataset.cashierName, from, to));
  });

  renderExportButtons('ccExportBtns', () => ({
    title: 'تقرير رقابة الكاشير', subtitle: `من ${from} إلى ${to}`,
    columns: [
      { key: 'cashierName', label: 'الكاشير' }, { key: 'salesCount', label: 'عدد المبيعات' }, { key: 'salesTotal', label: 'إجمالي المبيعات' },
      { key: 'returnsCount', label: 'عدد المرتجعات' }, { key: 'returnsTotal', label: 'إجمالي المرتجعات' }, { key: 'returnRatioPct', label: 'نسبة المرتجعات %' },
      { key: 'loyaltyDiscountTotal', label: 'خصم نقاط الولاء' }, { key: 'creditSalesCount', label: 'عدد المبيعات الآجلة' }, { key: 'creditSalesTotal', label: 'قيمة المبيعات الآجلة' },
      { key: 'disbApprovedCount', label: 'صرفيات معتمدة (عدد)' }, { key: 'disbApprovedTotal', label: 'صرفيات معتمدة (قيمة)' }, { key: 'disbRejectedCount', label: 'صرفيات مرفوضة' },
      { key: 'shiftsCount', label: 'عدد الشفتات' }, { key: 'cashVarianceTotal', label: 'إجمالي فرق النقدية' }, { key: 'networkVarianceTotal', label: 'إجمالي فرق الشبكة' },
      { key: 'flags', label: 'ملاحظات رقابية' },
    ],
    rows: data.rows.map((r) => ({
      cashierName: r.cashierName, salesCount: r.salesCount, salesTotal: r.salesTotal.toFixed(2),
      returnsCount: r.returnsCount, returnsTotal: r.returnsTotal.toFixed(2), returnRatioPct: r.returnRatioPct.toFixed(1),
      loyaltyDiscountTotal: r.loyaltyDiscountTotal.toFixed(2), creditSalesCount: r.creditSalesCount, creditSalesTotal: r.creditSalesTotal.toFixed(2),
      disbApprovedCount: r.disbApprovedCount, disbApprovedTotal: r.disbApprovedTotal.toFixed(2), disbRejectedCount: r.disbRejectedCount,
      shiftsCount: r.shiftsCount, cashVarianceTotal: r.cashVarianceTotal.toFixed(2), networkVarianceTotal: r.networkVarianceTotal.toFixed(2),
      flags: r.flags.join(' | ') || '-',
    })),
  }));
}

const CC_EVENT_TYPE_LABELS = { return: 'مردود', disbursement: 'صرف نقدي', shift_close: 'إغلاق شفت' };
async function renderCashierControlTimeline(cashierId, cashierName, from, to) {
  const wrap = document.getElementById('ccTimelineWrap');
  const title = document.getElementById('ccTimelineTitle');
  const out = document.getElementById('ccTimelineOutput');
  wrap.style.display = 'block';
  title.textContent = `السجل التفصيلي — ${cashierName}`;
  out.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const data = await Api.get(`/reports/cashier-control/${cashierId}/timeline?from=${from}&to=${to}`);
  if (data.events.length === 0) { out.innerHTML = '<div class="empty-note">لا توجد أحداث رقابية لهذا الكاشير في الفترة المحددة</div>'; return; }
  out.innerHTML = `<table><thead><tr><th>التاريخ والوقت</th><th>النوع</th><th>التفاصيل</th></tr></thead><tbody>
    ${data.events.map((e) => `<tr><td class="mono">${new Date(e.at).toLocaleString('ar-SA')}</td><td><span class="badge">${CC_EVENT_TYPE_LABELS[e.type] || e.type}</span></td><td>${escapeHtml(e.description)}</td></tr>`).join('')}
  </tbody></table>`;
}
