let companyCache = null;
let cachedChannels = [];
let pendingLogo = null;

async function loadChannelsCache() { cachedChannels = await Api.get('/channels'); return cachedChannels; }

function resizeImageToBase64(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; } }
        else { if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; } }
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}
function renderLogoPreview() {
  const slot = document.getElementById('logoPreviewSlot');
  slot.innerHTML = pendingLogo
    ? `<img src="${pendingLogo}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid var(--line);">`
    : '<div style="width:56px;height:56px;border-radius:10px;border:1px dashed var(--line); display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:10px; text-align:center;">لا يوجد</div>';
}
document.getElementById('logoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  pendingLogo = await resizeImageToBase64(file, 200, 0.8);
  renderLogoPreview();
});

async function renderSettings() {
  companyCache = await Api.get('/settings/company');
  document.getElementById('setCompanyName').value = companyCache?.name || '';
  document.getElementById('setVatNumber').value = companyCache?.vat_number || '';
  document.getElementById('setPhone').value = companyCache?.phone || '';
  document.getElementById('setAddress').value = companyCache?.address || '';
  pendingLogo = companyCache?.logo || null;
  renderLogoPreview();
  renderChannelsTable();
}
document.getElementById('saveCompanyBtn').onclick = async () => {
  const body = {
    name: document.getElementById('setCompanyName').value.trim(),
    vatNumber: document.getElementById('setVatNumber').value.trim(),
    phone: document.getElementById('setPhone').value.trim(),
    address: document.getElementById('setAddress').value.trim(),
    logo: pendingLogo,
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
