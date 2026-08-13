const CUSTOMER_TYPE_LABELS = { regular: 'عميل عادي', delivery_rider: 'مندوب توصيل' };

// ---------- Reusable customer/rider management panel ----------
// Renders into any container; defaultType pre-fills the "نوع العميل" field
// and filters the list, so the same component serves both "العملاء وبرنامج
// الولاء" and "مندوبو التوصيل" without duplicating the CRUD logic.
async function renderCustomerPanel(containerId, defaultType) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="form-card">
      <div class="field-row">
        <div class="field" style="flex:2;"><label>الاسم</label><input id="${containerId}_name"></div>
        <div class="field"><label>الجوال</label><input id="${containerId}_phone"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>نوع العميل</label>
          <select id="${containerId}_type">
            <option value="regular" ${defaultType === 'regular' ? 'selected' : ''}>عميل عادي</option>
            <option value="delivery_rider" ${defaultType === 'delivery_rider' ? 'selected' : ''}>مندوب توصيل</option>
          </select>
        </div>
        <div class="field" id="${containerId}_vehicleWrap" style="display:${defaultType === 'delivery_rider' ? 'block' : 'none'};"><label>نوع المركبة</label><input id="${containerId}_vehicle" placeholder="دراجة نارية / سيارة"></div>
      </div>
      <div class="field"><label>ملاحظات</label><input id="${containerId}_notes"></div>
      <button class="btn btn-blue" id="${containerId}_addBtn">إضافة</button>
      <div id="${containerId}_msg" class="msg" style="display:none;"></div>
    </div>
    <table>
      <thead><tr><th>الاسم</th><th>النوع</th><th>الجوال</th><th>النقاط</th><th>الرصيد</th></tr></thead>
      <tbody id="${containerId}_body"></tbody>
    </table>`;

  document.getElementById(`${containerId}_type`).addEventListener('change', (e) => {
    document.getElementById(`${containerId}_vehicleWrap`).style.display = e.target.value === 'delivery_rider' ? 'block' : 'none';
  });
  document.getElementById(`${containerId}_addBtn`).onclick = async () => {
    const name = document.getElementById(`${containerId}_name`).value.trim();
    const phone = document.getElementById(`${containerId}_phone`).value.trim();
    const customerType = document.getElementById(`${containerId}_type`).value;
    const vehicleType = document.getElementById(`${containerId}_vehicle`)?.value.trim();
    const notes = document.getElementById(`${containerId}_notes`).value.trim();
    const msg = document.getElementById(`${containerId}_msg`);
    if (!name) { alert('يرجى إدخال الاسم'); return; }
    try {
      await Api.post('/customers', { name, phone, customerType, vehicleType, notes });
      document.getElementById(`${containerId}_name`).value = '';
      document.getElementById(`${containerId}_phone`).value = '';
      document.getElementById(`${containerId}_notes`).value = '';
      msg.className = 'msg ok'; msg.textContent = '✓ تمت الإضافة'; msg.style.display = 'block';
      renderCustomerList(containerId, defaultType);
    } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
  };
  await renderCustomerList(containerId, defaultType);
}
async function renderCustomerList(containerId, filterType) {
  const body = document.getElementById(`${containerId}_body`);
  body.innerHTML = '<tr><td colspan="5" class="empty-note">جارٍ التحميل...</td></tr>';
  const list = await Api.get(`/customers?customerType=${filterType}`);
  body.innerHTML = '';
  if (list.length === 0) { body.innerHTML = '<tr><td colspan="5" class="empty-note">لا توجد سجلات بعد</td></tr>'; return; }
  list.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(c.name)}</td><td><span class="badge">${CUSTOMER_TYPE_LABELS[c.extra?.customerType] || '-'}</span>${c.extra?.vehicleType ? ` <span class="mono" style="font-size:11px; color:var(--muted);">${escapeHtml(c.extra.vehicleType)}</span>` : ''}</td>
      <td class="mono">${escapeHtml(c.extra?.phone || '-')}</td><td class="mono">${c.extra?.loyaltyPoints || 0}</td><td class="mono">${money(0)}</td>`;
    body.appendChild(tr);
  });
}

// ---------- POS sell screen: optional customer link + loyalty redemption ----------
let posSelectedCustomer = null;
document.getElementById('posCustomerSearchBtn').addEventListener('click', async () => {
  const q = document.getElementById('posCustomerSearch').value.trim();
  const results = document.getElementById('posCustomerResults');
  if (!q) { results.innerHTML = ''; return; }
  const list = await Api.get(`/customers?query=${encodeURIComponent(q)}`);
  if (list.length === 0) {
    results.innerHTML = `<div class="empty-note" style="padding:10px;">لا نتائج — <button class="btn btn-outline btn-sm" id="posCustomerQuickAdd">إضافة سريعة باسم "${escapeHtml(q)}"</button></div>`;
    document.getElementById('posCustomerQuickAdd').onclick = async () => {
      const created = await Api.post('/customers', { name: q, phone: /^\d+$/.test(q) ? q : '' });
      selectPosCustomer(created);
    };
    return;
  }
  results.innerHTML = list.map((c) => `<div class="pos-item-card" style="padding:8px 10px; margin-bottom:4px;" data-id="${c.id}">
    <div class="pn">${escapeHtml(c.name)} <span class="badge">${CUSTOMER_TYPE_LABELS[c.extra?.customerType] || ''}</span></div>
    <div class="pc">${escapeHtml(c.extra?.phone || '')} — نقاط: ${c.extra?.loyaltyPoints || 0}</div>
  </div>`).join('');
  results.querySelectorAll('[data-id]').forEach((el) => {
    el.onclick = () => selectPosCustomer(list.find((c) => c.id === el.dataset.id));
  });
});
function selectPosCustomer(customer) {
  posSelectedCustomer = customer;
  document.getElementById('posCustomerResults').innerHTML = '';
  document.getElementById('posCustomerSearch').value = '';
  const slot = document.getElementById('posCustomerSelected');
  slot.style.display = 'block';
  const points = customer.extra?.loyaltyPoints || 0;
  slot.innerHTML = `
    <div class="stock-pill" style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px;">
      <span>${escapeHtml(customer.name)} <span class="badge">${CUSTOMER_TYPE_LABELS[customer.extra?.customerType] || ''}</span> — نقاط: ${points}</span>
      <button class="del-entry" id="posCustomerClearBtn">إزالة</button>
    </div>
    <div class="field" style="margin-top:6px; margin-bottom:0;"><label>نقاط لاستبدالها كخصم (المتاح: ${points})</label><input id="posLoyaltyRedeem" type="number" min="0" max="${points}" value="0"></div>`;
  document.getElementById('posCustomerClearBtn').onclick = () => {
    posSelectedCustomer = null;
    slot.style.display = 'none'; slot.innerHTML = '';
  };
}
