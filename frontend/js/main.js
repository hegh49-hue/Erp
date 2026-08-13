let currentUser = null;

function showLogin() {
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
}
function showApp() {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
}

// Which top-level apps and POS sub-tabs each role may open — mirrors the
// backend's requireRole() gates so the nav never dangles a link that 403s.
const ROLE_APPS = {
  admin: ['home', 'accounting', 'pos', 'inventory', 'settings'],
  accountant: ['home', 'accounting', 'pos'],
  cashier: ['home', 'pos'],
};
const ROLE_POS_SUBTABS = {
  admin: null, // null = all
  cashier: ['sell', 'invoices', 'returns', 'shifts', 'disbursements', 'purchase-requests', 'settings'],
  accountant: ['disbursements'],
};
function applyRoleVisibility() {
  const allowedApps = ROLE_APPS[currentUser.role] || ['home'];
  document.querySelectorAll('#appNav button').forEach((b) => {
    b.style.display = allowedApps.includes(b.dataset.app) ? '' : 'none';
  });
  document.querySelectorAll('.app-card').forEach((c) => {
    c.style.display = allowedApps.includes(c.dataset.openApp) ? '' : 'none';
  });
  const allowedPosTabs = ROLE_POS_SUBTABS[currentUser.role];
  document.querySelectorAll('#posSubnav button').forEach((b) => {
    b.style.display = !allowedPosTabs || allowedPosTabs.includes(b.dataset.possub) ? '' : 'none';
  });
}

async function tryResumeSession() {
  if (!Api.token) { showLogin(); return; }
  try {
    const { user } = await Api.get('/auth/me');
    currentUser = user;
    document.getElementById('hdrUserName').textContent = user.fullName;
    showApp();
    applyRoleVisibility();
    await loadCompanyHeader();
    openApp(ROLE_APPS[user.role]?.includes('home') ? 'home' : ROLE_APPS[user.role][0]);
  } catch (err) {
    showLogin();
  }
}

document.getElementById('loginBtn').onclick = async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const { token, user } = await Api.post('/auth/login', { email, password });
    Api.setToken(token);
    currentUser = user;
    document.getElementById('hdrUserName').textContent = user.fullName;
    showApp();
    applyRoleVisibility();
    await loadCompanyHeader();
    openApp('home');
  } catch (err) {
    errEl.textContent = err.message;
  }
};
document.getElementById('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });

document.getElementById('logoutBtn').onclick = () => { Api.setToken(null); currentUser = null; showLogin(); };

async function loadCompanyHeader() {
  try {
    companyCache = await Api.get('/settings/company');
    document.getElementById('hdrCompanyName').textContent = companyCache?.name || 'منشأتي';
    const wrap = document.getElementById('hdrLogoWrap');
    wrap.innerHTML = companyCache?.logo
      ? `<img src="${companyCache.logo}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`
      : 'م';
  } catch (err) { /* ignore */ }
}

// ---------- App / subnav navigation ----------
function openApp(appKey) {
  document.querySelectorAll('#appNav button').forEach((b) => b.classList.toggle('active', b.dataset.app === appKey));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + appKey).classList.add('active');
  document.getElementById('accountingSubnav').style.display = appKey === 'accounting' ? 'flex' : 'none';
  document.getElementById('inventorySubnav').style.display = appKey === 'inventory' ? 'flex' : 'none';
  document.getElementById('posSubnav').style.display = appKey === 'pos' ? 'flex' : 'none';

  if (appKey === 'accounting') {
    const activeSub = document.querySelector('#view-accounting .subview.active');
    openAccountingSub(activeSub ? activeSub.id.replace('view-', '') : 'accounts');
  } else if (appKey === 'inventory') {
    const activeSub = document.querySelector('#view-inventory .subview.active');
    openInventorySub(activeSub ? activeSub.id.replace('inv-', '') : 'warehouses');
  } else if (appKey === 'pos') {
    const allowedPosTabs = ROLE_POS_SUBTABS[currentUser.role];
    const defaultTab = allowedPosTabs ? allowedPosTabs[0] : 'sell';
    const activeSub = document.querySelector('#view-pos .possub.active');
    const currentTab = activeSub ? activeSub.id.replace('pos-', '') : defaultTab;
    openPosSub(!allowedPosTabs || allowedPosTabs.includes(currentTab) ? currentTab : defaultTab);
  } else if (appKey === 'settings') {
    renderSettings();
  }
}
document.querySelectorAll('#appNav button').forEach((btn) => btn.addEventListener('click', () => openApp(btn.dataset.app)));
document.querySelectorAll('.app-card').forEach((card) => card.addEventListener('click', () => openApp(card.dataset.openApp)));

function openAccountingSub(subKey) {
  document.querySelectorAll('#accountingSubnav button').forEach((b) => b.classList.toggle('active', b.dataset.view === subKey));
  document.querySelectorAll('#view-accounting .subview').forEach((v) => { v.classList.remove('active'); v.style.display = 'none'; });
  const el = document.getElementById('view-' + subKey);
  el.classList.add('active'); el.style.display = 'block';
  if (subKey === 'accounts') renderAccountsTable();
  if (subKey === 'journal') { resetJournalFormIfNeeded(); renderEntriesList(); }
  if (subKey === 'subledger') { populateSubAccSelect(); }
  if (subKey === 'ledger') { populateLedgerAccounts(); }
  if (subKey === 'trial') renderTrialBalance();
  if (subKey === 'statements') renderStatements();
}
document.querySelectorAll('#accountingSubnav button').forEach((btn) => btn.addEventListener('click', () => openAccountingSub(btn.dataset.view)));

function openInventorySub(subKey) {
  document.querySelectorAll('#inventorySubnav button').forEach((b) => b.classList.toggle('active', b.dataset.invview === subKey));
  document.querySelectorAll('#view-inventory .subview').forEach((v) => { v.classList.remove('active'); v.style.display = 'none'; });
  const el = document.getElementById('inv-' + subKey);
  el.classList.add('active'); el.style.display = 'block';
  if (subKey === 'warehouses') renderWarehouses();
  if (subKey === 'items') renderInventoryItems();
  if (subKey === 'transfers') renderTransfers();
  if (subKey === 'counts') renderCounts();
  if (subKey === 'bom') renderBoms();
}
document.querySelectorAll('#inventorySubnav button').forEach((btn) => btn.addEventListener('click', () => openInventorySub(btn.dataset.invview)));

function openPosSub(subKey) {
  document.querySelectorAll('#posSubnav button').forEach((b) => b.classList.toggle('active', b.dataset.possub === subKey));
  document.querySelectorAll('#view-pos .possub').forEach((v) => { v.style.display = 'none'; v.classList.remove('active'); });
  const el = document.getElementById('pos-' + subKey);
  el.style.display = subKey === 'sell' ? 'flex' : 'block';
  el.classList.add('active');
  if (subKey === 'sell') initPosSell();
  if (subKey === 'invoices') renderPosInvoices();
  if (subKey === 'returns') initPosReturns();
  if (subKey === 'shifts') initPosShifts();
  if (subKey === 'disbursements') initPosDisbursements();
  if (subKey === 'purchase-requests') initPosPurchaseRequests();
  if (subKey === 'reports') renderPosReports();
  if (subKey === 'settings') initPosSettings();
}
document.querySelectorAll('#posSubnav button').forEach((btn) => btn.addEventListener('click', () => openPosSub(btn.dataset.possub)));

let activePosRpt = 'payment';
document.querySelectorAll('#pos-reports .subtab-btn').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#pos-reports .subtab-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    activePosRpt = b.dataset.posrpt;
    document.getElementById('rptGroupWrap').style.display = activePosRpt === 'items' ? 'block' : 'none';
    document.getElementById('rptRangeFilters').style.display = activePosRpt === 'closing' ? 'none' : 'flex';
    document.getElementById('rptClosingFilters').style.display = activePosRpt === 'closing' ? 'flex' : 'none';
    renderPosReports();
  };
});

document.querySelectorAll('#view-statements .subtab-btn').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#view-statements .subtab-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    activeFs = b.dataset.fs;
    document.getElementById('fsIncomeFilters').style.display = activeFs === 'income' ? 'flex' : 'none';
    document.getElementById('fsBalanceFilters').style.display = activeFs === 'balance' ? 'flex' : 'none';
    document.getElementById('fsCashflowFilters').style.display = activeFs === 'cashflow' ? 'flex' : 'none';
    document.getElementById('fsEquityFilters').style.display = activeFs === 'equity' ? 'flex' : 'none';
    renderStatements();
  };
});

tryResumeSession();
