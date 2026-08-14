const PR_STATUS_LABELS = { requested: 'مطلوب', fulfilled: 'تم التوفير', cancelled: 'ملغى' };

async function initPosPurchaseRequests() {
  document.getElementById('prCreateBtn').closest('.form-card').style.display = currentUser.role === 'accountant' ? 'none' : 'block';
  await renderPurchaseRequestsList();
}
document.getElementById('prStatusFilter').addEventListener('change', renderPurchaseRequestsList);

document.getElementById('prCreateBtn').onclick = async () => {
  const description = document.getElementById('prDescription').value.trim();
  const approxQty = document.getElementById('prApproxQty').value.trim();
  const note = document.getElementById('prNote').value.trim();
  const msg = document.getElementById('prCreateMsg');
  if (!description) { alert('يرجى إدخال وصف الصنف المطلوب'); return; }
  try {
    await Api.post('/purchase-requests', { description, approxQty, note });
    document.getElementById('prDescription').value = ''; document.getElementById('prApproxQty').value = ''; document.getElementById('prNote').value = '';
    msg.className = 'msg ok'; msg.textContent = '✓ تم إرسال الطلب'; msg.style.display = 'block';
    renderPurchaseRequestsList();
  } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
};

async function renderPurchaseRequestsList() {
  const wrap = document.getElementById('prList');
  wrap.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const status = document.getElementById('prStatusFilter').value;
  const list = await Api.get('/purchase-requests' + (status ? `?status=${status}` : ''));
  if (list.length === 0) { wrap.innerHTML = '<div class="empty-note">لا توجد طلبات</div>'; return; }
  wrap.innerHTML = '';
  list.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    const badgeClass = r.status === 'requested' ? 'warn' : '';
    let actionsHtml = '';
    if (currentUser.role === 'admin' && r.status === 'requested') {
      actionsHtml = `<div style="padding:0 16px 14px 16px; display:flex; gap:8px;">
        <button class="btn btn-blue btn-sm fulfilled-btn">تم التوفير</button>
        <button class="btn btn-outline btn-sm cancelled-btn">إلغاء</button>
      </div>`;
    }
    card.innerHTML = `<div class="entry-head" style="cursor:default;">
      <div class="eh-left"><span class="eh-date">${new Date(r.requested_at).toLocaleDateString('ar-SA')}</span>
        <span class="eh-desc">${escapeHtml(r.description)}${r.approx_qty ? ' — ' + escapeHtml(r.approx_qty) : ''}</span>
        <span class="badge ${badgeClass}">${PR_STATUS_LABELS[r.status]}</span></div>
      <span style="color:var(--muted); font-size:12px;">${escapeHtml(r.requested_by_name || '')}</span></div>
      ${r.note ? `<div style="padding:0 16px 8px 16px; font-size:12px; color:var(--muted);">${escapeHtml(r.note)}</div>` : ''}
      ${actionsHtml}`;
    const fulfilledBtn = card.querySelector('.fulfilled-btn');
    if (fulfilledBtn) fulfilledBtn.onclick = async () => { await Api.put(`/purchase-requests/${r.id}/status`, { status: 'fulfilled' }); renderPurchaseRequestsList(); };
    const cancelledBtn = card.querySelector('.cancelled-btn');
    if (cancelledBtn) cancelledBtn.onclick = async () => { await Api.put(`/purchase-requests/${r.id}/status`, { status: 'cancelled' }); renderPurchaseRequestsList(); };
    wrap.appendChild(card);
  });
}
