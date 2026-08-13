let disbReceiptBase64 = null;
document.getElementById('disbReceiptInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  disbReceiptBase64 = await resizeImageToBase64(file, 800, 0.7);
});

async function initPosDisbursements() {
  const isReviewer = currentUser.role === 'admin' || currentUser.role === 'accountant';
  document.getElementById('disbCreateCard').style.display = currentUser.role === 'accountant' ? 'none' : 'block';
  document.getElementById('disbListTitle').textContent = isReviewer ? 'كل الطلبات' : 'طلباتي';
  document.getElementById('shiftItemsClassifyWrap').style.display = isReviewer ? 'block' : 'none';
  await renderDisbursementsList();
  if (isReviewer) await renderShiftItemsClassifyList();
}

document.getElementById('disbCreateBtn').onclick = async () => {
  const description = document.getElementById('disbDescription').value.trim();
  const amount = parseFloat(document.getElementById('disbAmount').value);
  const msg = document.getElementById('disbCreateMsg');
  if (!description) { alert('يرجى إدخال وصف الصرف'); return; }
  if (!(amount > 0)) { alert('يرجى إدخال مبلغ صحيح'); return; }
  try {
    await Api.post('/disbursements', { cashierId: currentUser.cashierEntityId, amount, description, receiptAttachment: disbReceiptBase64 });
    document.getElementById('disbDescription').value = ''; document.getElementById('disbAmount').value = '';
    document.getElementById('disbReceiptInput').value = ''; disbReceiptBase64 = null;
    msg.className = 'msg ok'; msg.textContent = '✓ أُرسل الطلب وينتظر الاعتماد'; msg.style.display = 'block';
    renderDisbursementsList();
  } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
};

const DISB_STATUS_LABELS = { pending: 'معلّق', approved: 'معتمد', rejected: 'مرفوض' };
async function renderDisbursementsList() {
  const wrap = document.getElementById('disbList');
  wrap.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const isReviewer = currentUser.role === 'admin' || currentUser.role === 'accountant';
  const fullList = isReviewer ? await Api.get('/disbursements') : await Api.get('/disbursements/mine/' + currentUser.cashierEntityId);
  const list = fullList.filter((d) => !d.shift_id);
  if (list.length === 0) { wrap.innerHTML = '<div class="empty-note">لا توجد طلبات بعد</div>'; return; }
  if (isReviewer) await loadAccounts();
  wrap.innerHTML = '';
  list.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    const statusBadge = `<span class="badge ${d.status === 'pending' ? 'warn' : ''}">${DISB_STATUS_LABELS[d.status]}</span>`;
    const attachmentHtml = d.receipt_attachment ? `<a href="${d.receipt_attachment}" target="_blank" style="font-size:12px;">عرض الإيصال</a>` : '';
    let bodyHtml = `<div style="padding:0 16px 14px 16px; font-size:12.5px; color:var(--muted); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <span>${escapeHtml(d.cashier_name)} — ${new Date(d.requested_at).toLocaleString('ar-SA')}</span>${attachmentHtml}</div>`;
    if (d.status === 'rejected' && d.rejection_reason) {
      bodyHtml += `<div style="padding:0 16px 14px 16px; font-size:12.5px; color:var(--stamp);">سبب الرفض: ${escapeHtml(d.rejection_reason)}</div>`;
    }
    if (d.status === 'approved') {
      bodyHtml += `<div style="padding:0 16px 14px 16px; font-size:12.5px; color:var(--muted);">حساب المصروف: ${escapeHtml(d.expense_account_code || '')} - ${escapeHtml(d.expense_account_name || '')}</div>`;
    }
    if (isReviewer && d.status === 'pending') {
      bodyHtml += `<div style="padding:0 16px 14px 16px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <select class="approve-account-select" style="flex:1; min-width:180px;">${cachedAccounts.filter((a) => a.type === 'expense').map((a) => `<option value="${a.id}">${escapeHtml(a.code)} - ${escapeHtml(a.name)}</option>`).join('')}</select>
        <button class="btn btn-blue btn-sm approve-btn">اعتماد</button>
        <button class="btn btn-outline btn-sm reject-btn">رفض</button>
      </div>`;
    }
    card.innerHTML = `<div class="entry-head" style="cursor:default;">
      <div class="eh-left"><span class="eh-desc">${escapeHtml(d.description)}</span>${statusBadge}</div>
      <span class="eh-total mono">${money(d.amount)}</span></div>${bodyHtml}`;
    const approveBtn = card.querySelector('.approve-btn');
    if (approveBtn) approveBtn.onclick = async () => {
      const expenseAccountId = card.querySelector('.approve-account-select').value;
      try { await Api.post(`/disbursements/${d.id}/approve`, { expenseAccountId }); renderDisbursementsList(); } catch (err) { alert(err.message); }
    };
    const rejectBtn = card.querySelector('.reject-btn');
    if (rejectBtn) rejectBtn.onclick = async () => {
      const reason = prompt('سبب الرفض:');
      if (!reason) return;
      try { await Api.post(`/disbursements/${d.id}/reject`, { reason }); renderDisbursementsList(); } catch (err) { alert(err.message); }
    };
    wrap.appendChild(card);
  });
}

const DISB_SHIFT_ITEM_TYPE_LABELS = { expense: 'مصروف', purchase: 'مشتريات' };
let cachedSupervisors = [];
async function loadSupervisors() {
  await loadAccounts();
  const acc1500 = cachedAccounts.find((a) => a.code === '1500');
  if (!acc1500) { cachedSupervisors = []; return; }
  const res = await Api.get('/subledger/' + acc1500.id);
  cachedSupervisors = res.entities || [];
}
async function renderShiftItemsClassifyList() {
  const wrap = document.getElementById('shiftItemsClassifyList');
  wrap.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const [fullList] = await Promise.all([Api.get('/disbursements?status=awaiting_classification'), loadAccounts(), loadSupervisors()]);
  const list = fullList.filter((d) => d.shift_id);
  if (list.length === 0) { wrap.innerHTML = '<div class="empty-note">لا توجد بنود بانتظار التصنيف</div>'; return; }
  wrap.innerHTML = '';
  list.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    const typeBadge = `<span class="badge">${DISB_SHIFT_ITEM_TYPE_LABELS[d.item_type] || d.item_type}</span>`;
    const supervisorOptions = cachedSupervisors.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')
      || '<option value="">لا يوجد مشرفون مضافون بعد</option>';
    card.innerHTML = `<div class="entry-head" style="cursor:default;">
      <div class="eh-left"><span class="eh-desc">${escapeHtml(d.description)}</span>${typeBadge}</div>
      <span class="eh-total mono">${money(d.amount)}</span></div>
      <div style="padding:0 16px 14px 16px; font-size:12.5px; color:var(--muted);">${escapeHtml(d.cashier_name)} — ${new Date(d.requested_at).toLocaleString('ar-SA')}</div>
      <div style="padding:0 16px 14px 16px; display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start;">
        <div style="display:flex; gap:6px; align-items:center;">
          <label style="font-size:12.5px;"><input type="radio" name="cls-${d.id}" class="cls-resolution" value="account" checked> ترحيل كحساب محاسبي</label>
          <select class="cls-account-select" style="min-width:180px;">${cachedAccounts.map((a) => `<option value="${a.id}">${escapeHtml(a.code)} - ${escapeHtml(a.name)}</option>`).join('')}</select>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <label style="font-size:12.5px;"><input type="radio" name="cls-${d.id}" class="cls-resolution" value="supervisor"> تحميل على حساب مشرف (غير مبرَّر)</label>
          <select class="cls-supervisor-select" style="min-width:180px;" disabled>${supervisorOptions}</select>
          <button type="button" class="btn btn-outline btn-sm cls-add-supervisor">+ مشرف جديد</button>
        </div>
        <button class="btn btn-blue btn-sm cls-confirm-btn">تأكيد التصنيف</button>
      </div>`;
    card.querySelectorAll('.cls-resolution').forEach((r) => r.addEventListener('change', () => {
      const resolution = card.querySelector('.cls-resolution:checked').value;
      card.querySelector('.cls-account-select').disabled = resolution !== 'account';
      card.querySelector('.cls-supervisor-select').disabled = resolution !== 'supervisor';
    }));
    card.querySelector('.cls-add-supervisor').onclick = async () => {
      const name = prompt('اسم المشرف الجديد:');
      if (!name || !name.trim()) return;
      try {
        const acc1500 = cachedAccounts.find((a) => a.code === '1500');
        const code = 'SUP-' + Date.now().toString().slice(-6);
        const created = await Api.post('/subledger/' + acc1500.id, { code, name: name.trim() });
        cachedSupervisors.push(created);
        const sel = card.querySelector('.cls-supervisor-select');
        sel.innerHTML = cachedSupervisors.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
        sel.value = created.id;
        card.querySelector('input[value="supervisor"]').checked = true;
        card.querySelector('.cls-account-select').disabled = true;
        sel.disabled = false;
      } catch (err) { alert(err.message); }
    };
    card.querySelector('.cls-confirm-btn').onclick = async () => {
      const resolution = card.querySelector('.cls-resolution:checked').value;
      const body = { resolution };
      if (resolution === 'account') body.expenseAccountId = card.querySelector('.cls-account-select').value;
      else {
        const supervisorEntityId = card.querySelector('.cls-supervisor-select').value;
        if (!supervisorEntityId) { alert('يرجى اختيار المشرف أو إضافة مشرف جديد'); return; }
        body.supervisorEntityId = supervisorEntityId;
      }
      try { await Api.post(`/disbursements/${d.id}/classify`, body); renderShiftItemsClassifyList(); } catch (err) { alert(err.message); }
    };
    wrap.appendChild(card);
  });
}
