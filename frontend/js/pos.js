let posCart = [];
let posInited = false;

async function initPosSell() {
  await Promise.all([loadWarehouses(), loadItems(), loadChannelsCache()]);
  await populateCashierSelect();
  populatePosWarehouseSelect();
  populatePosPayMethod();
  renderPosCategories();
  renderPosItemsGrid();
  renderPosCart();
}

async function populateCashierSelect() {
  const sel = document.getElementById('posCashierSelect');
  const cur = sel.value;
  const cashiers = await Api.get('/pos/cashiers');
  sel.innerHTML = cashiers.map((c) => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('') + '<option value="__new__">+ إضافة كاشير جديد…</option>';
}
document.getElementById('posCashierSelect').addEventListener('change', async (e) => {
  if (e.target.value === '__new__') {
    const name = prompt('اسم الكاشير الجديد:');
    if (name && name.trim()) {
      const cashier = await Api.post('/pos/cashiers', { name: name.trim() });
      await populateCashierSelect();
      document.getElementById('posCashierSelect').value = cashier.id;
    } else {
      populateCashierSelect();
    }
  }
});
function populatePosWarehouseSelect() {
  const sel = document.getElementById('posWarehouseSelect');
  const cur = sel.value;
  sel.innerHTML = warehouseOptionsHtml(cur);
}
function populatePosPayMethod() {
  const sel = document.getElementById('posPayMethod');
  const cur = sel.value;
  let html = '<option value="نقدي">نقدي</option><option value="شبكة">شبكة</option><option value="تحويل">تحويل</option>';
  if (cachedChannels.length > 0) {
    html += '<optgroup label="قنوات خارجية">' + cachedChannels.map((c) => `<option value="channel:${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.extra?.type || '')})</option>`).join('') + '</optgroup>';
  }
  sel.innerHTML = html;
  if (cur) sel.value = cur;
}

let posActiveCat = 'الكل';
function renderPosCategories() {
  const sellable = cachedItems.filter((i) => i.is_sellable);
  const cats = ['الكل', ...new Set(sellable.map((i) => i.category || 'عام'))];
  const wrap = document.getElementById('posCatTabs');
  wrap.innerHTML = '';
  if (!cats.includes(posActiveCat)) posActiveCat = 'الكل';
  cats.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'subtab-btn' + (c === posActiveCat ? ' active' : '');
    b.textContent = c;
    b.onclick = () => { posActiveCat = c; renderPosCategories(); renderPosItemsGrid(); };
    wrap.appendChild(b);
  });
}
function renderPosItemsGrid() {
  const grid = document.getElementById('posItemsGrid');
  grid.innerHTML = '';
  const list = cachedItems.filter((i) => i.is_sellable && (posActiveCat === 'الكل' || (i.category || 'عام') === posActiveCat));
  if (list.length === 0) { grid.innerHTML = '<div class="empty-note" style="grid-column:1/-1;">لا توجد أصناف قابلة للبيع في هذا التصنيف</div>'; return; }
  list.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'pos-item-card';
    const availLine = item.is_stock_tracked ? `<div class="pc">متوفر ${item.totalQty}</div>` : `<div class="pc">خدمي</div>`;
    card.innerHTML = `<div class="pn">${escapeHtml(item.name)}</div>${availLine}<div class="pp">${money(item.price)}</div>`;
    card.onclick = () => {
      if (item.is_stock_tracked && item.totalQty <= 0) { alert('الكمية غير متوفرة بالمخزون'); return; }
      addToPosCart(item);
    };
    grid.appendChild(card);
  });
}
function addToPosCart(item) {
  const line = posCart.find((c) => c.id === item.id);
  const inCartQty = line ? line.qty : 0;
  if (item.is_stock_tracked && inCartQty + 1 > item.totalQty) { alert('الكمية المتاحة في المخزون غير كافية'); return; }
  if (line) line.qty += 1; else posCart.push({ id: item.id, name: item.name, price: Number(item.price), taxable: item.taxable, qty: 1, tracked: item.is_stock_tracked, avail: item.totalQty });
  renderPosCart();
}
function changePosCartQty(id, delta) {
  const line = posCart.find((c) => c.id === id);
  if (!line) return;
  if (delta > 0 && line.tracked && line.qty + 1 > line.avail) { alert('الكمية المتاحة بالمخزون غير كافية'); return; }
  line.qty += delta;
  if (line.qty <= 0) posCart = posCart.filter((c) => c.id !== id);
  renderPosCart();
}
document.getElementById('posClearCartBtn').onclick = () => { posCart = []; renderPosCart(); };
function renderPosCart() {
  const list = document.getElementById('posCartList');
  if (posCart.length === 0) { list.innerHTML = '<div class="empty-note">أضف أصنافاً من القائمة</div>'; }
  else {
    list.innerHTML = '';
    posCart.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'cart-row';
      row.innerHTML = `<div style="flex:1;"><div class="cn">${escapeHtml(c.name)}</div><div class="mono" style="font-size:11px; color:var(--muted);">${money(c.price)}</div></div>
        <div class="qty-ctrl"><button data-d="1">+</button><b>${c.qty}</b><button data-d="-1">−</button></div>`;
      row.querySelectorAll('button').forEach((b) => b.onclick = () => changePosCartQty(c.id, parseInt(b.dataset.d)));
      list.appendChild(row);
    });
  }
  let sub = 0, vat = 0;
  posCart.forEach((c) => {
    const lineTotal = c.price * c.qty;
    if (c.taxable) { const lineVat = lineTotal - (lineTotal / 1.15); sub += lineTotal - lineVat; vat += lineVat; }
    else sub += lineTotal;
  });
  document.getElementById('posSub').textContent = sub.toFixed(2);
  document.getElementById('posVat').textContent = vat.toFixed(2);
  document.getElementById('posTotal').textContent = (sub + vat).toFixed(2);
  document.getElementById('posCheckoutBtn').disabled = posCart.length === 0;
}

document.getElementById('posCheckoutBtn').onclick = async () => {
  const cashierId = document.getElementById('posCashierSelect').value;
  const warehouseId = document.getElementById('posWarehouseSelect').value;
  const requiresWarehouse = posCart.some((c) => c.tracked);
  if (!cashierId || cashierId === '__new__') { alert('يرجى اختيار الكاشير أولاً'); return; }
  if (requiresWarehouse && !warehouseId) { alert('يرجى اختيار المستودع أولاً — السلة تحتوي أصنافاً سلعية'); return; }
  const payMethodRaw = document.getElementById('posPayMethod').value;
  const payMethodLabel = document.querySelector('#posPayMethod option:checked').textContent;
  const payMethod = payMethodRaw.startsWith('channel:') ? 'channel' : payMethodRaw;
  const payEntityId = payMethodRaw.startsWith('channel:') ? payMethodRaw.replace('channel:', '') : null;
  const body = {
    cashierId, warehouseId, payMethod, payEntityId, payMethodLabel,
    orderType: document.getElementById('posOrderType').value,
    orderSource: document.getElementById('posOrderSource').value,
    items: posCart.map((c) => ({ itemId: c.id, qty: c.qty })),
  };
  try {
    const invoice = await Api.post('/pos/checkout', body);
    posCart = [];
    renderPosCart();
    await loadItems();
    renderPosItemsGrid();
    showPosReceipt(invoice, document.querySelector('#posCashierSelect option:checked').textContent);
  } catch (err) { alert(err.message); }
};

function showPosReceipt(inv, cashierName) {
  const el = document.getElementById('posReceiptContent');
  const dateStr = new Date(inv.issued_at).toLocaleString('ar-SA');
  const itemsHtml = inv.lines.map((it) => `<div class="r-row"><span>${escapeHtml(it.name)} × ${it.qty}</span><span>${(it.price * it.qty).toFixed(2)}</span></div>`).join('');
  el.innerHTML = `
    <h3>${escapeHtml(companyCache?.name || 'منشأتي')}</h3>
    <div class="r-sub">${escapeHtml(companyCache?.address || '')}</div>
    <div class="r-sub">الرقم الضريبي: ${escapeHtml(companyCache?.vat_number || '-')}</div>
    <div class="r-line"></div>
    <div class="r-row"><span>فاتورة ضريبية مبسطة</span><span>#${inv.number}</span></div>
    <div class="r-row"><span>التاريخ</span><span>${dateStr}</span></div>
    <div class="r-row"><span>الكاشير</span><span>${escapeHtml(cashierName || '')}</span></div>
    <div class="r-row"><span>الدفع</span><span>${escapeHtml(inv.pay_method_label)}</span></div>
    <div class="r-line"></div>
    ${itemsHtml}
    <div class="r-line"></div>
    <div class="r-row"><span>قبل الضريبة</span><span>${Number(inv.subtotal).toFixed(2)}</span></div>
    <div class="r-row"><span>ضريبة 15%</span><span>${Number(inv.vat).toFixed(2)}</span></div>
    <div class="r-row" style="font-weight:700; font-size:13px; border-top:1px dashed #999; padding-top:6px;"><span>الإجمالي</span><span>${Number(inv.total).toFixed(2)} ر.س</span></div>
    <div id="posQrcode"></div>
    <div class="r-footer">شكراً لزيارتكم</div>`;
  document.getElementById('posQrcode').innerHTML = '';
  if (inv.qr_base64 && window.QRCode) new QRCode(document.getElementById('posQrcode'), { text: inv.qr_base64, width: 110, height: 110, correctLevel: QRCode.CorrectLevel.M });
  document.getElementById('posReceiptOverlay').classList.add('open');
}
document.getElementById('posCloseReceiptBtn').onclick = () => document.getElementById('posReceiptOverlay').classList.remove('open');
document.getElementById('posNewSaleBtn').onclick = () => document.getElementById('posReceiptOverlay').classList.remove('open');
document.getElementById('posPrintBtn').onclick = () => window.print();

async function renderPosInvoices() {
  const body = document.getElementById('posInvBody');
  body.innerHTML = '<tr><td colspan="7" class="empty-note">جارٍ التحميل...</td></tr>';
  const invoices = await Api.get('/pos/invoices');
  body.innerHTML = '';
  const todayStr = new Date().toDateString();
  let todayNet = 0, todayCount = 0;
  invoices.forEach((inv) => {
    const isReturn = inv.doc_type === 'credit_note';
    if (new Date(inv.issued_at).toDateString() === todayStr) { todayNet += isReturn ? -Number(inv.total) : Number(inv.total); todayCount++; }
    const tr = document.createElement('tr');
    const badge = isReturn ? `<span class="badge warn">مردود${inv.original_invoice_number ? ' — أصل #' + escapeHtml(inv.original_invoice_number) : ''}</span>` : '';
    tr.innerHTML = `<td class="mono">#${inv.number} ${badge}</td><td>${new Date(inv.issued_at).toLocaleString('ar-SA')}</td><td>${escapeHtml(inv.cashier_name)}</td><td>${escapeHtml(inv.warehouse_name || '—')}</td><td>${escapeHtml(inv.pay_method_label)}</td>
      <td class="mono" style="color:${isReturn ? 'var(--stamp)' : 'inherit'};">${isReturn ? '-' : ''}${money(inv.total)}</td>
      <td><button class="del-entry" data-id="${inv.id}">عرض</button></td>`;
    tr.querySelector('button').onclick = async () => {
      const detail = await Api.get('/pos/invoices/' + inv.id);
      showPosReceipt(detail, inv.cashier_name);
    };
    body.appendChild(tr);
  });
  document.getElementById('posInvSummary').textContent = `اليوم: ${todayCount} مستند • صافي ${todayNet.toFixed(2)} ر.س`;
  if (invoices.length === 0) body.innerHTML = '<tr><td colspan="7" class="empty-note">لا توجد فواتير مسجّلة بعد</td></tr>';
}

// ---------- Sales returns (credit notes) ----------
async function initPosReturns() {
  document.getElementById('retSearchResult').innerHTML = '';
  document.getElementById('retInvoiceNumber').value = '';
  renderPosReturnsHistory();
}
document.getElementById('retSearchBtn').onclick = async () => {
  const number = document.getElementById('retInvoiceNumber').value.trim();
  const out = document.getElementById('retSearchResult');
  if (!number) { alert('أدخل رقم الفاتورة'); return; }
  out.innerHTML = '<div class="empty-note">جارٍ البحث...</div>';
  try {
    const inv = await Api.get('/pos/invoices/by-number/' + encodeURIComponent(number));
    renderReturnForm(inv);
  } catch (err) {
    out.innerHTML = `<div class="msg err" style="display:block;">${escapeHtml(err.message)}</div>`;
  }
};
function renderReturnForm(inv) {
  const out = document.getElementById('retSearchResult');
  const returnableLines = inv.lines.filter((l) => l.remainingQty > 0);
  if (returnableLines.length === 0) {
    out.innerHTML = `<div class="msg" style="display:block;">لا توجد كميات متبقية قابلة للإرجاع في الفاتورة #${escapeHtml(inv.number)}</div>`;
    return;
  }
  const rows = returnableLines.map((l) => `<tr data-item="${l.itemId}" data-max="${l.remainingQty}">
      <td>${escapeHtml(l.name)} (${escapeHtml(l.unit)})</td>
      <td class="mono">${l.soldQty}</td>
      <td class="mono">${l.alreadyReturnedQty}</td>
      <td class="mono">${l.remainingQty}</td>
      <td><input type="number" step="0.0001" min="0" max="${l.remainingQty}" class="return-qty-input" style="width:100px;" value="0"></td>
    </tr>`).join('');
  out.innerHTML = `
    <div class="form-card">
      <div class="panel-header" style="margin-bottom:10px;"><h2 style="font-size:15px;">فاتورة #${escapeHtml(inv.number)} — ${escapeHtml(inv.cashier_name)}</h2></div>
      <table><thead><tr><th>الصنف</th><th>الكمية المباعة</th><th>مُرجَع سابقاً</th><th>المتبقي القابل للإرجاع</th><th>الكمية المرتجَعة الآن</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <button class="btn btn-primary" id="retSubmitBtn" style="width:100%; margin-top:12px;">تنفيذ الإرجاع</button>
      <div id="retMsg" class="msg" style="display:none;"></div>
    </div>`;
  document.getElementById('retSubmitBtn').onclick = async () => {
    const lines = [...out.querySelectorAll('tr[data-item]')].map((tr) => ({
      itemId: tr.dataset.item, qty: parseFloat(tr.querySelector('.return-qty-input').value) || 0,
    })).filter((l) => l.qty > 0);
    const msg = document.getElementById('retMsg');
    if (lines.length === 0) { alert('أدخل كمية إرجاع لصنف واحد على الأقل'); return; }
    try {
      const cn = await Api.post(`/pos/invoices/${inv.id}/return`, { lines });
      msg.className = 'msg ok'; msg.textContent = `✓ تم إصدار إشعار دائن #${cn.number}`; msg.style.display = 'block';
      setTimeout(() => { document.getElementById('retSearchResult').innerHTML = ''; document.getElementById('retInvoiceNumber').value = ''; }, 1500);
      renderPosReturnsHistory();
    } catch (err) {
      msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block';
    }
  };
}
async function renderPosReturnsHistory() {
  const wrap = document.getElementById('retHistoryList');
  wrap.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const invoices = await Api.get('/pos/invoices');
  const returns = invoices.filter((i) => i.doc_type === 'credit_note');
  if (returns.length === 0) { wrap.innerHTML = '<div class="empty-note">لا توجد مردودات مسجّلة بعد</div>'; return; }
  wrap.innerHTML = '';
  returns.forEach((cn) => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `<div class="entry-head" style="cursor:default;">
      <div class="eh-left"><span class="eh-date">${new Date(cn.issued_at).toLocaleString('ar-SA')}</span>
        <span class="eh-desc">#${escapeHtml(cn.number)} — مرجع فاتورة #${escapeHtml(cn.original_invoice_number || '-')}</span></div>
      <span class="eh-total mono" style="color:var(--stamp);">-${money(cn.total)}</span></div>`;
    wrap.appendChild(card);
  });
}

// ---------- POS reports ----------
document.getElementById('rptFrom').addEventListener('change', renderPosReports);
document.getElementById('rptTo').addEventListener('change', renderPosReports);
document.getElementById('rptGroupBy').addEventListener('change', renderPosReports);
async function renderPosReports() {
  if (!document.getElementById('rptFrom').value) {
    const now = new Date();
    document.getElementById('rptFrom').value = todayISO(new Date(now.getFullYear(), now.getMonth(), 1));
    document.getElementById('rptTo').value = todayISO();
  }
  const from = document.getElementById('rptFrom').value, to = document.getElementById('rptTo').value;
  const out = document.getElementById('rptOutput');
  out.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';

  if (activePosRpt === 'payment') {
    const r = await Api.get(`/reports/pos-by-payment?from=${from}&to=${to}`);
    if (r.methods.length === 0) { out.innerHTML = '<div class="empty-note">لا توجد بيانات في هذه الفترة</div>'; return; }
    const methodsHtml = r.methods.map((m) => `
      <div class="entry-card">
        <div class="entry-head" style="cursor:default;">
          <div class="eh-left"><span class="eh-desc">${escapeHtml(m.payMethodLabel)}</span><span class="badge">${m.salesCount} بيع${m.returnsCount ? ' / ' + m.returnsCount + ' مردود' : ''}</span></div>
          <span class="eh-total mono">${money(m.netAmount)}</span>
        </div>
        <div style="padding:0 16px 14px 16px;">
          <table style="margin-top:0;"><thead><tr><th>الكاشير</th><th>عدد المبيعات</th><th>عدد المردودات</th><th>الصافي</th></tr></thead>
          <tbody>${m.byCashier.map((c) => `<tr><td>${escapeHtml(c.cashierName)}</td><td class="mono">${c.salesCount}</td><td class="mono">${c.returnsCount}</td><td class="mono">${money(c.netAmount)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>`).join('');
    out.innerHTML = `${methodsHtml}
      <div class="stat-cards">
        <div class="stat-card"><div class="label">إجمالي عدد المبيعات</div><div class="value mono">${r.grandSalesCount}</div></div>
        <div class="stat-card"><div class="label">إجمالي عدد المردودات</div><div class="value mono">${r.grandReturnsCount}</div></div>
        <div class="stat-card"><div class="label">الإجمالي العام (صافي)</div><div class="value mono">${money(r.grandTotal)}</div></div>
      </div>`;
  } else {
    const groupBy = document.getElementById('rptGroupBy').value;
    const r = await Api.get(`/reports/pos-sales-by-item?from=${from}&to=${to}&groupBy=${groupBy}`);
    if (r.rows.length === 0) { out.innerHTML = '<div class="empty-note">لا توجد بيانات في هذه الفترة</div>'; return; }
    const headLabel = groupBy === 'category' ? 'المجموعة' : 'الصنف';
    const rows = r.rows.map((row) => `<tr><td>${escapeHtml(row.label || 'غير مصنّف')}</td><td class="mono">${row.qty}</td><td class="mono">${money(row.revenue)}</td>${groupBy === 'category' ? `<td class="mono">${row.pct.toFixed(1)}%</td>` : ''}</tr>`).join('');
    out.innerHTML = `
      <table><thead><tr><th>${headLabel}</th><th>الكمية المباعة</th><th>الإيراد</th>${groupBy === 'category' ? '<th>النسبة من الإجمالي</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row"><td>الإجمالي</td><td class="mono">${r.totalQty}</td><td class="mono">${money(r.totalRevenue)}</td>${groupBy === 'category' ? '<td class="mono">100%</td>' : ''}</tr></tfoot></table>`;
  }
}
