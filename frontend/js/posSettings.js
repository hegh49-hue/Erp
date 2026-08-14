let activePosSetting = 'users';
document.querySelectorAll('#pos-settings .subtab-btn').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#pos-settings .subtab-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    activePosSetting = b.dataset.possetting;
    document.querySelectorAll('.possetting-panel').forEach((p) => { p.style.display = 'none'; });
    document.getElementById('possetting-' + activePosSetting).style.display = 'block';
    renderPosSettingsPanel();
  };
});

async function initPosSettings() {
  document.querySelectorAll('.possetting-panel').forEach((p) => { p.style.display = 'none'; });
  document.getElementById('possetting-' + activePosSetting).style.display = 'block';
  await renderPosSettingsPanel();
}
async function renderPosSettingsPanel() {
  if (activePosSetting === 'users') await renderUsersPanel();
  if (activePosSetting === 'customers') await renderCustomerLoyaltyPanel();
  if (activePosSetting === 'delivery') await renderCustomerPanel('riderPanel', 'delivery_rider');
  if (activePosSetting === 'businessday') await renderPosSettingsBizDay();
}

// ---------- Users & roles (admin only) ----------
document.getElementById('usrRole').addEventListener('change', (e) => {
  document.getElementById('usrCashierNameWrap').style.display = e.target.value === 'cashier' ? 'block' : 'none';
});
document.getElementById('usrCreateBtn').onclick = async () => {
  const fullName = document.getElementById('usrFullName').value.trim();
  const email = document.getElementById('usrEmail').value.trim();
  const password = document.getElementById('usrPassword').value;
  const role = document.getElementById('usrRole').value;
  const cashierName = document.getElementById('usrCashierName').value.trim();
  const msg = document.getElementById('usrCreateMsg');
  if (!fullName || !email || !password) { alert('يرجى تعبئة كل الحقول'); return; }
  try {
    await Api.post('/users', { fullName, email, password, role, cashierName });
    document.getElementById('usrFullName').value = ''; document.getElementById('usrEmail').value = '';
    document.getElementById('usrPassword').value = ''; document.getElementById('usrCashierName').value = '';
    msg.className = 'msg ok'; msg.textContent = '✓ تمت إضافة المستخدم'; msg.style.display = 'block';
    renderUsersPanel();
  } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
};
const USER_ROLE_LABELS = { admin: 'مدير نظام', accountant: 'محاسب', cashier: 'كاشير' };
async function renderUsersPanel() {
  if (currentUser.role !== 'admin') {
    document.getElementById('possetting-users').innerHTML = '<div class="empty-note">هذه الشاشة متاحة لمدير النظام فقط</div>';
    return;
  }
  const body = document.getElementById('usrTableBody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="6" class="empty-note">جارٍ التحميل...</td></tr>';
  const users = await Api.get('/users');
  body.innerHTML = '';
  users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(u.full_name)}</td><td class="mono">${escapeHtml(u.email)}</td><td><span class="badge">${USER_ROLE_LABELS[u.role]}</span></td>
      <td>${escapeHtml(u.cashier_name || '-')}</td><td>${u.is_active ? '✓' : '✕'}</td>
      <td><button class="btn btn-outline btn-sm toggle-active-btn">${u.is_active ? 'تعطيل' : 'تفعيل'}</button></td>`;
    tr.querySelector('.toggle-active-btn').onclick = async () => {
      await Api.put(`/users/${u.id}`, { isActive: !u.is_active });
      renderUsersPanel();
    };
    body.appendChild(tr);
  });
}

// ---------- Loyalty program settings ----------
async function renderCustomerLoyaltyPanel() {
  const company = await Api.get('/settings/company').catch(() => null);
  if (company) {
    document.getElementById('loyRiyalPerPoint').value = company.loyalty_riyal_per_point;
    document.getElementById('loyPointValue').value = company.loyalty_point_value;
  }
  const isAdmin = currentUser.role === 'admin';
  document.getElementById('loyRiyalPerPoint').disabled = !isAdmin;
  document.getElementById('loyPointValue').disabled = !isAdmin;
  document.getElementById('loySaveBtn').style.display = isAdmin ? 'inline-block' : 'none';
  await renderCustomerPanel('custPanel', 'regular');
}
document.getElementById('loySaveBtn').addEventListener('click', async () => {
  const msg = document.getElementById('loyMsg');
  try {
    const company = await Api.get('/settings/company');
    await Api.put('/settings/company', {
      name: company.name, vatNumber: company.vat_number, phone: company.phone, address: company.address, logo: company.logo,
      businessDayStartHour: company.business_day_start_hour,
      loyaltyRiyalPerPoint: parseFloat(document.getElementById('loyRiyalPerPoint').value) || 10,
      loyaltyPointValue: parseFloat(document.getElementById('loyPointValue').value) || 0.5,
    });
    msg.className = 'msg ok'; msg.textContent = '✓ تم الحفظ'; msg.style.display = 'block';
  } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
});

// ---------- Business day (duplicated single field for convenience) ----------
async function renderPosSettingsBizDay() {
  const sel = document.getElementById('possettingBizDayHour');
  if (!sel.options.length) sel.innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');
  const company = await Api.get('/settings/company').catch(() => null);
  if (company) sel.value = company.business_day_start_hour;
  const isAdmin = currentUser.role === 'admin';
  sel.disabled = !isAdmin;
  document.getElementById('possettingBizDaySaveBtn').style.display = isAdmin ? 'inline-block' : 'none';
}
document.getElementById('possettingBizDaySaveBtn').addEventListener('click', async () => {
  const msg = document.getElementById('possettingBizDayMsg');
  try {
    const company = await Api.get('/settings/company');
    await Api.put('/settings/company', {
      name: company.name, vatNumber: company.vat_number, phone: company.phone, address: company.address, logo: company.logo,
      businessDayStartHour: parseInt(document.getElementById('possettingBizDayHour').value, 10),
    });
    msg.className = 'msg ok'; msg.textContent = '✓ تم الحفظ'; msg.style.display = 'block';
  } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
});

// ---------- Items/BOM shortcuts ----------
document.getElementById('possettingsGoToItemsBtn').addEventListener('click', () => {
  openApp('inventory'); openInventorySub('items');
});
document.getElementById('possettingsGoToBomBtn').addEventListener('click', () => {
  openApp('inventory'); openInventorySub('bom');
});
