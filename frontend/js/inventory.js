const ITEM_TYPE_LABELS = { raw: 'خام', semi_finished: 'نصف مصنّع', finished: 'تام', packaging: 'تعبئة', consumable: 'مستهلكات' };
let cachedWarehouses = [];
let cachedItems = [];

async function loadWarehouses() { cachedWarehouses = await Api.get('/inventory/warehouses'); return cachedWarehouses; }
async function loadItems() { cachedItems = await Api.get('/inventory/items'); return cachedItems; }

function warehouseOptionsHtml(selectedId) {
  return cachedWarehouses.map((w) => `<option value="${w.id}" ${w.id === selectedId ? 'selected' : ''}>${escapeHtml(w.code)} - ${escapeHtml(w.name)}</option>`).join('') || '<option value="">لا توجد مستودعات — أضف واحداً أولاً</option>';
}
function itemOptionsHtml(selectedId, onlyStockTracked) {
  const list = onlyStockTracked ? cachedItems.filter((i) => i.is_stock_tracked) : cachedItems;
  return '<option value="">اختر الصنف</option>' + list.map((i) => `<option value="${i.id}" ${i.id === selectedId ? 'selected' : ''}>${escapeHtml(i.name)} (${escapeHtml(i.unit)})</option>`).join('');
}

// ---------- Warehouses ----------
document.getElementById('addWarehouseBtn').onclick = async () => {
  const name = document.getElementById('whName').value.trim();
  if (!name) { alert('يرجى إدخال اسم المستودع'); return; }
  try {
    await Api.post('/inventory/warehouses', { name });
    document.getElementById('whName').value = '';
    renderWarehouses();
  } catch (err) { alert(err.message); }
};
async function renderWarehouses() {
  const grid = document.getElementById('warehousesGrid');
  grid.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  await loadWarehouses();
  grid.innerHTML = '';
  if (cachedWarehouses.length === 0) { grid.innerHTML = '<div class="empty-note">لا توجد مستودعات بعد — أضف أول مستودع أعلاه</div>'; return; }
  cachedWarehouses.forEach((w) => {
    const card = document.createElement('div');
    card.className = 'wh-card';
    card.innerHTML = `<div class="wname">${escapeHtml(w.name)} <span class="mono" style="color:var(--muted); font-size:11px;">${escapeHtml(w.code)}</span></div>
      <div class="wstat"><span>قيمة المخزون</span><span class="mono">${money(w.value)}</span></div>
      <div class="wstat"><span>إجمالي الكمية</span><span class="mono">${w.totalQty}</span></div>`;
    grid.appendChild(card);
  });
}

// ---------- Items & stock ----------
document.getElementById('itTaxable'); // noop reference to ensure element exists at load
document.getElementById('addItemBtn').onclick = async () => {
  const name = document.getElementById('itName').value.trim();
  const itemType = document.getElementById('itType').value;
  const unit = document.getElementById('itUnit').value.trim() || 'قطعة';
  const price = parseFloat(document.getElementById('itPrice').value) || 0;
  const taxable = document.getElementById('itTaxable').value === 'yes';
  const isSellable = document.getElementById('itSellable').value === 'yes';
  if (!name) { alert('يرجى إدخال اسم الصنف'); return; }
  try {
    await Api.post('/inventory/items', { name, itemType, unit, price, taxable, isSellable, isStockTracked: true });
    document.getElementById('itName').value = ''; document.getElementById('itPrice').value = '';
    renderInventoryItems();
  } catch (err) { alert(err.message); }
};
async function renderInventoryItems() {
  const body = document.getElementById('itemsBody');
  body.innerHTML = '<tr><td colspan="6" class="empty-note">جارٍ التحميل...</td></tr>';
  await Promise.all([loadItems(), loadWarehouses()]);
  body.innerHTML = '';
  if (cachedItems.length === 0) { body.innerHTML = '<tr><td colspan="6" class="empty-note">لا توجد أصناف بعد</td></tr>'; }
  cachedItems.forEach((it) => {
    const lowStock = it.reorder_point > 0 && it.totalQty <= Number(it.reorder_point);
    const perWh = it.stock.map((s) => `<span class="stock-pill ${Number(s.qty) <= 0 ? 'low' : ''}">${escapeHtml(s.warehouse_code)}: ${Number(s.qty)}</span>`).join(' ') || '<span class="stock-pill">لا يوجد رصيد</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(it.name)}</td><td>${ITEM_TYPE_LABELS[it.item_type]}</td><td>${escapeHtml(it.unit)}</td><td class="mono">${money(it.price)}</td>
      <td class="mono" style="color:${lowStock ? 'var(--stamp)' : 'inherit'};">${it.totalQty}${lowStock ? ' ⚠' : ''}</td>
      <td>${perWh}</td>`;
    body.appendChild(tr);
  });
  // populate the receive/adjust selects
  document.getElementById('rcvItem').innerHTML = itemOptionsHtml(document.getElementById('rcvItem').value, true);
  document.getElementById('rcvWarehouse').innerHTML = warehouseOptionsHtml(document.getElementById('rcvWarehouse').value);
}
document.getElementById('rcvMode').addEventListener('change', (e) => {
  document.getElementById('rcvCostWrap').style.display = e.target.value === 'receive' ? 'block' : 'none';
});
document.getElementById('rcvSubmitBtn').onclick = async () => {
  const itemId = document.getElementById('rcvItem').value;
  const warehouseId = document.getElementById('rcvWarehouse').value;
  const mode = document.getElementById('rcvMode').value;
  const qty = parseFloat(document.getElementById('rcvQty').value);
  const cost = parseFloat(document.getElementById('rcvCost').value) || 0;
  const note = document.getElementById('rcvNote').value.trim();
  const msg = document.getElementById('rcvMsg');
  msg.style.display = 'none';
  if (!itemId || !warehouseId) { alert('يرجى اختيار الصنف والمستودع'); return; }
  if (!qty) { alert('يرجى إدخال كمية صحيحة'); return; }
  try {
    if (mode === 'receive') {
      await Api.post(`/inventory/items/${itemId}/receive`, { warehouseId, qty, unitCost: cost, note });
    } else {
      await Api.post(`/inventory/items/${itemId}/adjust`, { warehouseId, qty, note });
    }
    msg.className = 'msg ok'; msg.textContent = '✓ تم التنفيذ بنجاح'; msg.style.display = 'block';
    document.getElementById('rcvQty').value = ''; document.getElementById('rcvNote').value = '';
    renderInventoryItems();
  } catch (err) {
    msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block';
  }
};

// ---------- Transfers ----------
let trLines = [];
function trNewLine() { return { itemId: '', qty: '' }; }
function renderTrLines() {
  const container = document.getElementById('trLinesContainer');
  container.innerHTML = '';
  trLines.forEach((line, idx) => {
    const row = document.createElement('div');
    row.className = 'line-row';
    row.innerHTML = `<select class="acc-select" style="flex:2;">${itemOptionsHtml(line.itemId, true)}</select>
      <input class="amount-input" type="number" step="0.0001" placeholder="الكمية" value="${line.qty}">
      <button class="remove-line">✕</button>`;
    row.querySelector('select').onchange = (e) => { trLines[idx].itemId = e.target.value; };
    row.querySelector('input').oninput = (e) => { trLines[idx].qty = e.target.value; };
    row.querySelector('.remove-line').onclick = () => { trLines.splice(idx, 1); renderTrLines(); };
    container.appendChild(row);
  });
}
document.getElementById('trAddLineBtn').onclick = () => { trLines.push(trNewLine()); renderTrLines(); };
document.getElementById('trSubmitBtn').onclick = async () => {
  const fromWarehouseId = document.getElementById('trFrom').value;
  const toWarehouseId = document.getElementById('trTo').value;
  const date = document.getElementById('trDate').value || todayISO();
  const note = document.getElementById('trNote').value.trim();
  const msg = document.getElementById('trMsg');
  msg.style.display = 'none';
  const lines = trLines.filter((l) => l.itemId && parseFloat(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: parseFloat(l.qty) }));
  if (!fromWarehouseId || !toWarehouseId) { alert('يرجى اختيار المستودعين'); return; }
  if (lines.length === 0) { alert('أضف صنفاً واحداً على الأقل'); return; }
  try {
    await Api.post('/inventory/transfers', { fromWarehouseId, toWarehouseId, date, note, lines });
    msg.className = 'msg ok'; msg.textContent = '✓ تم تنفيذ التحويل'; msg.style.display = 'block';
    trLines = [trNewLine()]; renderTrLines();
    document.getElementById('trNote').value = '';
    renderTransfers();
  } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
};
async function renderTransfers() {
  await Promise.all([loadWarehouses(), loadItems()]);
  document.getElementById('trFrom').innerHTML = warehouseOptionsHtml(document.getElementById('trFrom').value);
  document.getElementById('trTo').innerHTML = warehouseOptionsHtml(document.getElementById('trTo').value);
  if (trLines.length === 0) trLines = [trNewLine()];
  renderTrLines();
  if (!document.getElementById('trDate').value) document.getElementById('trDate').value = todayISO();

  const list = document.getElementById('transfersList');
  list.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const transfers = await Api.get('/inventory/transfers');
  if (transfers.length === 0) { list.innerHTML = '<div class="empty-note">لا توجد تحويلات مسجّلة بعد</div>'; return; }
  list.innerHTML = '';
  transfers.forEach((t) => {
    const linesHtml = t.lines.map((l) => `${escapeHtml(l.item_name)} × ${Number(l.qty)}`).join('، ');
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `<div class="entry-head" style="cursor:default;">
      <div class="eh-left"><span class="eh-date">${t.transfer_date.slice(0, 10)}</span>
        <span class="eh-desc">${escapeHtml(t.from_warehouse_name)} ← ${escapeHtml(t.to_warehouse_name)}</span></div>
      <span class="mono" style="color:var(--muted); font-size:12px;">${escapeHtml(linesHtml)}</span></div>`;
    list.appendChild(card);
  });
}

// ---------- Stock counts (جرد) ----------
document.getElementById('cntCreateBtn').onclick = async () => {
  const warehouseId = document.getElementById('cntWarehouse').value;
  const date = document.getElementById('cntDate').value || todayISO();
  if (!warehouseId) { alert('يرجى اختيار المستودع'); return; }
  try {
    const count = await Api.post('/inventory/counts', { warehouseId, date });
    renderCounts();
    openCountModal(count.id);
  } catch (err) { alert(err.message); }
};
async function renderCounts() {
  await loadWarehouses();
  document.getElementById('cntWarehouse').innerHTML = warehouseOptionsHtml(document.getElementById('cntWarehouse').value);
  if (!document.getElementById('cntDate').value) document.getElementById('cntDate').value = todayISO();

  const list = document.getElementById('countsList');
  list.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const counts = await Api.get('/inventory/counts');
  if (counts.length === 0) { list.innerHTML = '<div class="empty-note">لا توجد عمليات جرد بعد</div>'; return; }
  list.innerHTML = '';
  counts.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    const statusBadge = c.status === 'posted' ? '<span class="badge">مُرحَّل</span>' : '<span class="badge warn">مسودة</span>';
    card.innerHTML = `<div class="entry-head">
      <div class="eh-left"><span class="eh-date">${c.count_date.slice(0, 10)}</span><span class="eh-desc">${escapeHtml(c.warehouse_name)}</span>${statusBadge}</div>
      <button class="btn btn-outline btn-sm">${c.status === 'draft' ? 'متابعة الجرد' : 'عرض'}</button></div>`;
    card.querySelector('button').onclick = () => openCountModal(c.id);
    list.appendChild(card);
  });
}
async function openCountModal(countId) {
  const overlay = document.getElementById('countModalOverlay');
  const content = document.getElementById('countModalContent');
  content.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  overlay.classList.add('open');
  const count = await Api.get('/inventory/counts/' + countId);
  const draft = count.status === 'draft';
  const rows = count.lines.map((l) => `<tr data-item="${l.item_id}">
      <td>${escapeHtml(l.item_name)} (${escapeHtml(l.unit)})</td>
      <td class="mono">${Number(l.system_qty)}</td>
      <td>${draft ? `<input type="number" step="0.0001" class="counted-input" value="${l.counted_qty ?? ''}" style="width:110px;">` : `<span class="mono">${l.counted_qty ?? '-'}</span>`}</td>
    </tr>`).join('');
  content.innerHTML = `
    <div class="panel-header"><h2>جرد — ${escapeHtml(count.warehouse_name)} (${count.count_date.slice(0, 10)})</h2></div>
    <table><thead><tr><th>الصنف</th><th>الرصيد الدفتري</th><th>الكمية الفعلية</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="empty-note">لا توجد أصناف برصيد في هذا المستودع</td></tr>'}</tbody></table>
    ${draft ? `<div style="display:flex; gap:10px; margin-top:14px;">
      <button class="btn btn-outline" id="cntSaveLinesBtn" style="flex:1;">حفظ الكميات</button>
      <button class="btn btn-primary" id="cntPostBtn" style="flex:1;">ترحيل الجرد</button>
    </div>
    <div id="cntModalMsg" class="msg" style="display:none;"></div>` : ''}`;
  if (draft) {
    document.getElementById('cntSaveLinesBtn').onclick = async () => {
      const lines = [...content.querySelectorAll('tr[data-item]')].map((tr) => ({
        itemId: tr.dataset.item, countedQty: tr.querySelector('.counted-input').value === '' ? null : parseFloat(tr.querySelector('.counted-input').value),
      }));
      try { await Api.put(`/inventory/counts/${countId}/lines`, { lines }); showCntMsg('✓ تم الحفظ', 'ok'); } catch (err) { showCntMsg(err.message, 'err'); }
    };
    document.getElementById('cntPostBtn').onclick = async () => {
      if (!confirm('ترحيل الجرد سيحدّث الأرصدة الفعلية ويسجّل قيد فروقات إن وُجدت. متابعة؟')) return;
      const lines = [...content.querySelectorAll('tr[data-item]')].map((tr) => ({
        itemId: tr.dataset.item, countedQty: tr.querySelector('.counted-input').value === '' ? null : parseFloat(tr.querySelector('.counted-input').value),
      }));
      try {
        await Api.put(`/inventory/counts/${countId}/lines`, { lines });
        await Api.post(`/inventory/counts/${countId}/post`, {});
        showCntMsg('✓ تم ترحيل الجرد', 'ok');
        renderCounts();
        setTimeout(() => openCountModal(countId), 600);
      } catch (err) { showCntMsg(err.message, 'err'); }
    };
  }
  function showCntMsg(text, cls) {
    const el = document.getElementById('cntModalMsg');
    if (!el) return;
    el.className = 'msg ' + cls; el.textContent = text; el.style.display = 'block';
  }
}
document.getElementById('countModalCloseBtn').onclick = () => document.getElementById('countModalOverlay').classList.remove('open');

// ---------- BOM ----------
let bomLines = [];
function bomNewLine() { return { componentItemId: '', qty: '' }; }
function renderBomLines() {
  const container = document.getElementById('bomLinesContainer');
  container.innerHTML = '';
  bomLines.forEach((line, idx) => {
    const row = document.createElement('div');
    row.className = 'line-row';
    row.innerHTML = `<select class="acc-select" style="flex:2;">${itemOptionsHtml(line.componentItemId, true)}</select>
      <input class="amount-input" type="number" step="0.0001" placeholder="الكمية لكل وحدة ناتج" value="${line.qty}">
      <button class="remove-line">✕</button>`;
    row.querySelector('select').onchange = (e) => { bomLines[idx].componentItemId = e.target.value; };
    row.querySelector('input').oninput = (e) => { bomLines[idx].qty = e.target.value; };
    row.querySelector('.remove-line').onclick = () => { bomLines.splice(idx, 1); renderBomLines(); };
    container.appendChild(row);
  });
}
document.getElementById('bomAddLineBtn').onclick = () => { bomLines.push(bomNewLine()); renderBomLines(); };
document.getElementById('bomSubmitBtn').onclick = async () => {
  const outputItemId = document.getElementById('bomOutputItem').value;
  const name = document.getElementById('bomName').value.trim() || 'وصفة قياسية';
  const outputQty = parseFloat(document.getElementById('bomOutputQty').value) || 1;
  const msg = document.getElementById('bomMsg');
  msg.style.display = 'none';
  const lines = bomLines.filter((l) => l.componentItemId && parseFloat(l.qty) > 0).map((l) => ({ componentItemId: l.componentItemId, qty: parseFloat(l.qty) }));
  if (!outputItemId) { alert('يرجى اختيار الصنف الناتج'); return; }
  if (lines.length === 0) { alert('أضف مكوّناً واحداً على الأقل'); return; }
  try {
    await Api.post('/inventory/boms', { outputItemId, name, outputQty, lines });
    msg.className = 'msg ok'; msg.textContent = '✓ تم حفظ الوصفة'; msg.style.display = 'block';
    bomLines = [bomNewLine()]; renderBomLines();
    document.getElementById('bomName').value = '';
    renderBoms();
  } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
};
async function renderBoms() {
  await loadItems();
  document.getElementById('bomOutputItem').innerHTML = itemOptionsHtml(document.getElementById('bomOutputItem').value, false);
  if (bomLines.length === 0) { bomLines = [bomNewLine()]; renderBomLines(); }

  const list = document.getElementById('bomsList');
  list.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const boms = await Api.get('/inventory/boms');
  if (boms.length === 0) { list.innerHTML = '<div class="empty-note">لا توجد وصفات معرّفة بعد</div>'; return; }
  list.innerHTML = '';
  boms.forEach((b) => {
    const componentsHtml = b.lines.map((l) => `${escapeHtml(l.component_name)} × ${Number(l.qty)} ${escapeHtml(l.component_unit)}`).join('، ');
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `<div class="entry-head" style="cursor:default;">
      <div class="eh-left"><span class="eh-desc">${escapeHtml(b.output_item_name)} — ${escapeHtml(b.name)}</span>
        <span class="badge">ينتج ${Number(b.output_qty)} ${escapeHtml(b.output_unit)}</span></div>
      <button class="del-entry" data-id="${b.id}">حذف</button></div>
      <div style="padding:0 16px 12px 16px; font-size:12.5px; color:var(--muted);">المكوّنات: ${escapeHtml(componentsHtml)}</div>`;
    card.querySelector('.del-entry').onclick = async () => {
      if (!confirm('حذف هذه الوصفة؟')) return;
      try { await Api.del('/inventory/boms/' + b.id); renderBoms(); } catch (err) { alert(err.message); }
    };
    list.appendChild(card);
  });
}
