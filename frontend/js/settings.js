let companyCache = null;
let cachedChannels = [];

async function loadChannelsCache() { cachedChannels = await Api.get('/channels'); return cachedChannels; }

async function renderSettings() {
  companyCache = await Api.get('/settings/company');
  document.getElementById('setCompanyName').value = companyCache?.name || '';
  document.getElementById('setVatNumber').value = companyCache?.vat_number || '';
  document.getElementById('setPhone').value = companyCache?.phone || '';
  document.getElementById('setAddress').value = companyCache?.address || '';
  renderChannelsTable();
}
document.getElementById('saveCompanyBtn').onclick = async () => {
  const body = {
    name: document.getElementById('setCompanyName').value.trim(),
    vatNumber: document.getElementById('setVatNumber').value.trim(),
    phone: document.getElementById('setPhone').value.trim(),
    address: document.getElementById('setAddress').value.trim(),
    logo: companyCache?.logo || null,
  };
  try {
    companyCache = await Api.put('/settings/company', body);
    await loadCompanyHeader();
    const msg = document.getElementById('settingsMsg');
    msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 2000);
  } catch (err) { alert(err.message); }
};

document.getElementById('addChannelBtn').onclick = async () => {
  const name = document.getElementById('chName').value.trim();
  const type = document.getElementById('chType').value;
  const commissionPct = parseFloat(document.getElementById('chCommission').value) || 0;
  const settlementCycle = document.getElementById('chCycle').value;
  if (!name) { alert('يرجى إدخال اسم القناة'); return; }
  try {
    await Api.post('/channels', { name, type, commissionPct, settlementCycle });
    document.getElementById('chName').value = ''; document.getElementById('chCommission').value = '';
    renderChannelsTable();
  } catch (err) { alert(err.message); }
};
async function renderChannelsTable() {
  const body = document.getElementById('channelsBody');
  body.innerHTML = '<tr><td colspan="6" class="empty-note">جارٍ التحميل...</td></tr>';
  await loadChannelsCache();
  body.innerHTML = '';
  if (cachedChannels.length === 0) { body.innerHTML = '<tr><td colspan="6" class="empty-note">لا توجد قنوات مسجّلة بعد</td></tr>'; return; }
  cachedChannels.forEach((ch) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(ch.name)}</td><td>${escapeHtml(ch.extra?.type || '-')}</td><td class="mono">${ch.extra?.commissionPct || 0}%</td><td>${escapeHtml(ch.extra?.settlementCycle || '-')}</td>
      <td class="mono">${money(ch.due)}</td>
      <td><button class="btn btn-outline btn-sm settle-btn" ${ch.due <= 0 ? 'disabled' : ''}>تسوية</button></td>`;
    tr.querySelector('.settle-btn').onclick = async () => {
      if (!confirm(`تسوية "${ch.name}"؟ سيتم ترحيل قيد الصافي المحوَّل للبنك وعمولة القناة.`)) return;
      try { await Api.post(`/channels/${ch.id}/settle`, {}); renderChannelsTable(); } catch (err) { alert(err.message); }
    };
    body.appendChild(tr);
  });
}
