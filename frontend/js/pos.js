let posCart = [];
let posInited = false;
let posBomOutputItemIds = new Set();

async function initPosSell() {
  const [, , , boms] = await Promise.all([loadWarehouses(), loadItems(), loadChannelsCache(), Api.get('/inventory/boms')]);
  posBomOutputItemIds = new Set(boms.map((b) => b.output_item_id));
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
  html += '<option value="credit_customer">آجل — عميل</option>';
  if (cachedChannels.length > 0) {
    html += '<optgroup label="آجل — قنوات خارجية">' + cachedChannels.map((c) => `<option value="channel:${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.extra?.type || '')})</option>`).join('') + '</optgroup>';
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
    const isBomItem = posBomOutputItemIds.has(item.id);
    const card = document.createElement('div');
    card.className = 'pos-item-card';
    const availLine = isBomItem ? '<div class="pc">وصفة تصنيع</div>' : (item.is_stock_tracked ? `<div class="pc">متوفر ${item.totalQty}</div>` : '<div class="pc">خدمي</div>');
    card.innerHTML = `<div class="pn">${escapeHtml(item.name)}</div>${availLine}<div class="pp">${money(item.price)}</div>`;
    card.onclick = () => {
      if (!isBomItem && item.is_stock_tracked && item.totalQty <= 0) { alert('الكمية غير متوفرة بالمخزون'); return; }
      addToPosCart(item);
    };
    grid.appendChild(card);
  });
}
function addToPosCart(item) {
  const isBomItem = posBomOutputItemIds.has(item.id);
  const line = posCart.find((c) => c.id === item.id);
  const inCartQty = line ? line.qty : 0;
  if (!isBomItem && item.is_stock_tracked && inCartQty + 1 > item.totalQty) { alert('الكمية المتاحة في المخزون غير كافية'); return; }
  if (line) line.qty += 1; else posCart.push({ id: item.id, name: item.name, price: Number(item.price), taxable: item.taxable, qty: 1, tracked: item.is_stock_tracked && !isBomItem, isBom: isBomItem, avail: item.totalQty });
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

  const requiresWarehouse = posCart.some((c) => c.tracked || c.isBom);
  document.getElementById('posWarehouseField').style.display = requiresWarehouse ? 'block' : 'none';
}

document.getElementById('posCheckoutBtn').onclick = async () => {
  const cashierId = document.getElementById('posCashierSelect').value;
  const warehouseId = document.getElementById('posWarehouseSelect').value;
  const requiresWarehouse = posCart.some((c) => c.tracked || c.isBom);
  if (!cashierId || cashierId === '__new__') { alert('يرجى اختيار الكاشير أولاً'); return; }
  if (requiresWarehouse && !warehouseId) { alert('يرجى اختيار المستودع أولاً — السلة تحتوي أصنافاً سلعية'); return; }
  const payMethodRaw = document.getElementById('posPayMethod').value;
  const payMethodLabel = document.querySelector('#posPayMethod option:checked').textContent;
  const payMethod = payMethodRaw.startsWith('channel:') ? 'channel' : payMethodRaw;
  const payEntityId = payMethodRaw.startsWith('channel:') ? payMethodRaw.replace('channel:', '') : null;
  if (payMethod === 'credit_customer' && !posSelectedCustomer) { alert('يرجى اختيار العميل للبيع الآجل'); return; }
  const redeemInput = document.getElementById('posLoyaltyRedeem');
  const body = {
    cashierId, warehouseId, payMethod, payEntityId, payMethodLabel,
    orderType: document.getElementById('posOrderType').value,
    orderSource: document.getElementById('posOrderSource').value,
    items: posCart.map((c) => ({ itemId: c.id, qty: c.qty })),
    customerId: posSelectedCustomer?.id || null,
    loyaltyPointsToRedeem: redeemInput ? parseInt(redeemInput.value, 10) || 0 : 0,
    customerName: document.getElementById('posOrderCustomerName').value.trim(),
    customerPhone: document.getElementById('posOrderCustomerPhone').value.trim(),
    customerArea: document.getElementById('posOrderCustomerArea').value.trim(),
    orderNote: document.getElementById('posOrderNote').value.trim(),
  };
  try {
    const invoice = await Api.post('/pos/checkout', body);
    posCart = [];
    renderPosCart();
    await loadItems();
    renderPosItemsGrid();
    posSelectedCustomer = null;
    document.getElementById('posCustomerSelected').style.display = 'none';
    document.getElementById('posCustomerSelected').innerHTML = '';
    document.getElementById('posOrderCustomerName').value = '';
    document.getElementById('posOrderCustomerPhone').value = '';
    document.getElementById('posOrderCustomerArea').value = '';
    document.getElementById('posOrderNote').value = '';
    showPosReceipt(invoice, document.querySelector('#posCashierSelect option:checked').textContent);
  } catch (err) { alert(err.message); }
};

function showPosReceipt(inv, cashierName) {
  const el = document.getElementById('posReceiptContent');
  const dateStr = new Date(inv.issued_at).toLocaleString('ar-SA');
  const lineTotal = (it) => (it.price ?? it.unit_price ?? 0) * it.qty;
  const itemsHtml = inv.lines.map((it) => `<div class="r-row"><span>${escapeHtml(it.name)} × ${it.qty}</span><span>${lineTotal(it).toFixed(2)}</span></div>`).join('');
  const customerHtml = (inv.customer_name || inv.customer_phone || inv.customer_area) ? `
    <div class="r-row"><span>العميل</span><span>${escapeHtml(inv.customer_name || '')}</span></div>
    ${inv.customer_phone ? `<div class="r-row"><span>الجوال</span><span>${escapeHtml(inv.customer_phone)}</span></div>` : ''}
    ${inv.customer_area ? `<div class="r-row"><span>المنطقة</span><span>${escapeHtml(inv.customer_area)}</span></div>` : ''}
    <div class="r-line"></div>` : '';
  const noteHtml = inv.order_note ? `<div class="r-line"></div><div class="r-row" style="font-weight:700;"><span>ملاحظة</span></div><div style="font-size:12px; padding:4px 0;">${escapeHtml(inv.order_note)}</div>` : '';
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
    ${customerHtml}
    ${itemsHtml}
    <div class="r-line"></div>
    <div class="r-row"><span>قبل الضريبة</span><span>${Number(inv.subtotal).toFixed(2)}</span></div>
    <div class="r-row"><span>ضريبة 15%</span><span>${Number(inv.vat).toFixed(2)}</span></div>
    <div class="r-row" style="font-weight:700; font-size:13px; border-top:1px dashed #999; padding-top:6px;"><span>الإجمالي</span><span>${Number(inv.total).toFixed(2)} ر.س</span></div>
    ${noteHtml}
    <div id="posQrcode"></div>
    <div class="r-footer">شكراً لزيارتكم</div>`;
  document.getElementById('posQrcode').innerHTML = '';
  if (inv.qr_base64 && window.QRCode) new QRCode(document.getElementById('posQrcode'), { text: inv.qr_base64, width: 110, height: 110, correctLevel: QRCode.CorrectLevel.M });
  document.getElementById('posKitchenTicketContent').dataset.invoice = JSON.stringify(inv);
  document.getElementById('posReceiptContent').style.display = 'block';
  document.getElementById('posKitchenTicketContent').style.display = 'none';
  document.getElementById('posReceiptOverlay').classList.add('open');
}
document.getElementById('posCloseReceiptBtn').onclick = () => document.getElementById('posReceiptOverlay').classList.remove('open');
document.getElementById('posNewSaleBtn').onclick = () => document.getElementById('posReceiptOverlay').classList.remove('open');

function buildKitchenTicketHtml(inv) {
  const dateStr = new Date(inv.issued_at).toLocaleString('ar-SA');
  const itemsHtml = inv.lines.map((it) => `<div class="r-row" style="font-size:15px; font-weight:600;"><span>${escapeHtml(it.name)}</span><span>× ${it.qty}</span></div>`).join('');
  return `
    <h3>نسخة المطبخ / التغليف</h3>
    <div class="r-row"><span>فاتورة</span><span>#${inv.number}</span></div>
    <div class="r-row"><span>التاريخ</span><span>${dateStr}</span></div>
    <div class="r-row"><span>نوع الطلب</span><span>${escapeHtml(inv.order_type || '')}</span></div>
    <div class="r-row"><span>مصدر الطلب</span><span>${escapeHtml(inv.order_source || '')}</span></div>
    ${(inv.customer_name || inv.customer_phone || inv.customer_area) ? `
      <div class="r-line"></div>
      <div class="r-row"><span>العميل</span><span>${escapeHtml(inv.customer_name || '')}</span></div>
      ${inv.customer_phone ? `<div class="r-row"><span>الجوال</span><span>${escapeHtml(inv.customer_phone)}</span></div>` : ''}
      ${inv.customer_area ? `<div class="r-row"><span>المنطقة</span><span>${escapeHtml(inv.customer_area)}</span></div>` : ''}` : ''}
    <div class="r-line"></div>
    ${itemsHtml}
    <div class="r-line"></div>
    ${inv.order_note ? `<div style="border:2px solid var(--stamp); border-radius:8px; padding:10px; margin-top:8px;">
        <div style="font-weight:700; font-size:13px; margin-bottom:4px;">⚠ ملاحظة</div>
        <div style="font-size:15px; font-weight:700;">${escapeHtml(inv.order_note)}</div>
      </div>` : '<div class="r-sub">لا توجد ملاحظات</div>'}`;
}
document.getElementById('posPrintKitchenBtn').onclick = () => {
  const raw = document.getElementById('posKitchenTicketContent').dataset.invoice;
  if (!raw) return;
  const inv = JSON.parse(raw);
  document.getElementById('posKitchenTicketContent').innerHTML = buildKitchenTicketHtml(inv);
  document.getElementById('posReceiptContent').style.display = 'none';
  document.getElementById('posKitchenTicketContent').style.display = 'block';
  window.print();
  document.getElementById('posReceiptContent').style.display = 'block';
  document.getElementById('posKitchenTicketContent').style.display = 'none';
};
document.getElementById('posPrintBtn').onclick = () => window.print();

async function renderPosInvoices() {
  const body = document.getElementById('posInvBody');
  body.innerHTML = '<tr><td colspan="7" class="empty-note">جارٍ التحميل...</td></tr>';
  const invoices = await Api.get('/pos/invoices');
  body.innerHTML = '';
  const todayBusinessDate = currentBusinessDate(companyCache?.business_day_start_hour ?? 6);
  let todayNet = 0, todayCount = 0;
  invoices.forEach((inv) => {
    const isReturn = inv.doc_type === 'credit_note';
    if (inv.business_date.slice(0, 10) === todayBusinessDate) { todayNet += isReturn ? -Number(inv.total) : Number(inv.total); todayCount++; }
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
    renderExportButtons('posRptExportBtns', () => ({
      title: 'تقرير المبيعات حسب طريقة الدفع', subtitle: `من ${from} إلى ${to}`,
      columns: [{ key: 'method', label: 'طريقة الدفع' }, { key: 'cashier', label: 'الكاشير' }, { key: 'salesCount', label: 'عدد المبيعات' }, { key: 'returnsCount', label: 'عدد المردودات' }, { key: 'netAmount', label: 'الصافي' }],
      rows: r.methods.flatMap((m) => m.byCashier.map((c) => ({ method: m.payMethodLabel, cashier: c.cashierName, salesCount: c.salesCount, returnsCount: c.returnsCount, netAmount: c.netAmount.toFixed(2) }))),
    }));
  } else if (activePosRpt === 'items') {
    const groupBy = document.getElementById('rptGroupBy').value;
    const r = await Api.get(`/reports/pos-sales-by-item?from=${from}&to=${to}&groupBy=${groupBy}`);
    if (r.rows.length === 0) { out.innerHTML = '<div class="empty-note">لا توجد بيانات في هذه الفترة</div>'; return; }
    const headLabel = groupBy === 'category' ? 'المجموعة' : 'الصنف';
    const rows = r.rows.map((row) => `<tr><td>${escapeHtml(row.label || 'غير مصنّف')}</td><td class="mono">${row.qty}</td><td class="mono">${money(row.revenue)}</td>${groupBy === 'category' ? `<td class="mono">${row.pct.toFixed(1)}%</td>` : ''}</tr>`).join('');
    out.innerHTML = `
      <table><thead><tr><th>${headLabel}</th><th>الكمية المباعة</th><th>الإيراد</th>${groupBy === 'category' ? '<th>النسبة من الإجمالي</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row"><td>الإجمالي</td><td class="mono">${r.totalQty}</td><td class="mono">${money(r.totalRevenue)}</td>${groupBy === 'category' ? '<td class="mono">100%</td>' : ''}</tr></tfoot></table>`;
    renderExportButtons('posRptExportBtns', () => ({
      title: groupBy === 'category' ? 'المبيعات حسب المجموعة' : 'المبيعات حسب الصنف', subtitle: `من ${from} إلى ${to}`,
      columns: groupBy === 'category'
        ? [{ key: 'label', label: 'المجموعة' }, { key: 'qty', label: 'الكمية' }, { key: 'revenue', label: 'الإيراد' }, { key: 'pct', label: 'النسبة%' }]
        : [{ key: 'label', label: 'الصنف' }, { key: 'qty', label: 'الكمية' }, { key: 'revenue', label: 'الإيراد' }],
      rows: r.rows.map((row) => ({ label: row.label || 'غير مصنّف', qty: row.qty, revenue: row.revenue.toFixed(2), pct: row.pct?.toFixed(1) })),
    }));
  } else {
    if (!document.getElementById('rptClosingDate').value) {
      document.getElementById('rptClosingDate').value = currentBusinessDate(companyCache?.business_day_start_hour ?? 6);
    }
    const businessDate = document.getElementById('rptClosingDate').value;
    const r = await Api.get(`/reports/pos-daily-closing?businessDate=${businessDate}`);
    const payRows = r.byPaymentMethod.map((m) => `<tr><td>${escapeHtml(m.payMethodLabel)}</td><td class="mono">${m.salesCount}</td><td class="mono">${m.returnsCount}</td><td class="mono">${money(m.netAmount)}</td></tr>`).join('');
    const topRows = r.topItems.map((it, idx) => `<tr><td>${idx + 1}</td><td>${escapeHtml(it.name)}</td><td class="mono">${it.qty}</td><td class="mono">${money(it.revenue)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-note">لا توجد بيانات</td></tr>';
    out.innerHTML = `
      <div class="printable-report">
        <h3 style="margin:0 0 4px 0;">تقرير إغلاق يوم العمل — ${escapeHtml(r.businessDate)}</h3>
        <div class="stat-cards">
          <div class="stat-card"><div class="label">قبل الضريبة</div><div class="value mono">${money(r.subtotal)}</div></div>
          <div class="stat-card"><div class="label">الضريبة</div><div class="value mono">${money(r.vat)}</div></div>
          <div class="stat-card"><div class="label">إجمالي المبيعات</div><div class="value mono">${money(r.total)}</div></div>
          <div class="stat-card"><div class="label">عدد الفواتير</div><div class="value mono">${r.invoiceCount}</div></div>
        </div>
        <div class="stat-cards">
          <div class="stat-card"><div class="label">عدد المردودات</div><div class="value mono">${r.returnsCount}</div></div>
          <div class="stat-card"><div class="label">قيمة المردودات</div><div class="value mono">${money(r.returnsTotal)}</div></div>
          <div class="stat-card"><div class="label">صافي المبيعات</div><div class="value mono" style="color:var(--green);">${money(r.netTotal)}</div></div>
        </div>
        <h3 style="font-size:14px; margin:16px 0 8px 0;">توزيع المبيعات حسب طريقة الدفع</h3>
        <table><thead><tr><th>الطريقة</th><th>عدد المبيعات</th><th>عدد المردودات</th><th>الصافي</th></tr></thead><tbody>${payRows || '<tr><td colspan="4" class="empty-note">لا توجد بيانات</td></tr>'}</tbody></table>
        <h3 style="font-size:14px; margin:16px 0 8px 0;">أعلى 5 أصناف مبيعاً</h3>
        <table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>الإيراد</th></tr></thead><tbody>${topRows}</tbody></table>
      </div>`;
    renderExportButtons('posRptExportBtns', () => ({
      title: 'تقرير إغلاق يوم العمل', subtitle: `يوم العمل ${r.businessDate}`,
      columns: [{ key: 'section', label: 'القسم' }, { key: 'item', label: 'البند' }, { key: 'value', label: 'القيمة' }],
      rows: [
        { section: 'الإجماليات', item: 'قبل الضريبة', value: r.subtotal.toFixed(2) },
        { section: 'الإجماليات', item: 'الضريبة', value: r.vat.toFixed(2) },
        { section: 'الإجماليات', item: 'إجمالي المبيعات', value: r.total.toFixed(2) },
        { section: 'الإجماليات', item: 'عدد الفواتير', value: r.invoiceCount },
        { section: 'الإجماليات', item: 'عدد المردودات', value: r.returnsCount },
        { section: 'الإجماليات', item: 'قيمة المردودات', value: r.returnsTotal.toFixed(2) },
        { section: 'الإجماليات', item: 'صافي المبيعات', value: r.netTotal.toFixed(2) },
        ...r.byPaymentMethod.map((m) => ({ section: 'طرق الدفع', item: m.payMethodLabel, value: m.netAmount.toFixed(2) })),
        ...r.topItems.map((it, i) => ({ section: 'أعلى الأصناف', item: `${i + 1}. ${it.name}`, value: `${it.qty} — ${it.revenue.toFixed(2)}` })),
      ],
    }));
  }
}
document.getElementById('rptClosingDate').addEventListener('change', renderPosReports);
document.getElementById('rptPrintBtn').addEventListener('click', () => window.print());

// ---------- Cashier shifts (till reconciliation) ----------
async function initPosShifts() {
  const sel = document.getElementById('shCashierSelect');
  const cur = sel.value;
  const cashiers = await Api.get('/pos/cashiers');
  sel.innerHTML = cashiers.map((c) => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  if (!sel.value && cashiers[0]) sel.value = cashiers[0].id;
  await refreshShiftsView();
}
document.getElementById('shCashierSelect').addEventListener('change', refreshShiftsView);
async function refreshShiftsView() {
  const cashierId = document.getElementById('shCashierSelect').value;
  if (!cashierId) { document.getElementById('shCurrentShift').innerHTML = '<div class="empty-note">أضف كاشيراً أولاً من فاتورة المبيعات</div>'; document.getElementById('shHistoryList').innerHTML = ''; return; }
  await Promise.all([renderCurrentShift(cashierId), renderShiftsHistory(cashierId)]);
}

async function renderCurrentShift(cashierId) {
  const wrap = document.getElementById('shCurrentShift');
  wrap.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const shift = await Api.get('/pos/shifts/open/' + cashierId);
  if (!shift) {
    wrap.innerHTML = `
      <div class="form-card">
        <div class="field"><label>الرصيد الافتتاحي (العهدة النقدية)</label><input id="shOpeningFloat" type="number" step="0.01" placeholder="0.00"></div>
        <div class="field"><label>ملاحظة</label><input id="shOpenNote" placeholder="اختياري"></div>
        <button class="btn btn-blue" id="shOpenBtn" style="width:100%;">فتح شفت جديد</button>
        <div id="shOpenMsg" class="msg" style="display:none;"></div>
      </div>`;
    document.getElementById('shOpenBtn').onclick = async () => {
      const openingFloat = parseFloat(document.getElementById('shOpeningFloat').value) || 0;
      const note = document.getElementById('shOpenNote').value.trim();
      const msg = document.getElementById('shOpenMsg');
      try {
        await Api.post('/pos/shifts/open', { cashierId, openingFloat, note });
        refreshShiftsView();
      } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
    };
    return;
  }
  const denominations = companyCache?.currency_denominations || [500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25];
  const disb = shift.live.disbursements || [];
  const disbHtml = disb.length
    ? `<table style="margin-top:10px;"><thead><tr><th>الوصف</th><th>المبلغ</th><th>المرفق</th></tr></thead><tbody>
        ${disb.map((d) => `<tr><td>${escapeHtml(d.description)}</td><td class="mono">${money(d.amount)}</td><td>${d.receipt_attachment ? `<a href="${d.receipt_attachment}" target="_blank">عرض</a>` : '-'}</td></tr>`).join('')}
       </tbody></table>`
    : '<div class="empty-note">لا توجد مصروفات معتمدة خلال هذا الشفت</div>';

  wrap.innerHTML = `
    <div class="form-card">
      <div class="panel-header" style="margin-bottom:10px;"><h2 style="font-size:15px;">شفت مفتوح منذ ${new Date(shift.opened_at).toLocaleString('ar-SA')}</h2><span class="badge">${escapeHtml(shift.cashier_name)}</span></div>
      <div class="stat-cards">
        <div class="stat-card"><div class="label">الرصيد الافتتاحي</div><div class="value mono">${money(shift.opening_float)}</div></div>
        <div class="stat-card"><div class="label">صافي المبيعات النقدية</div><div class="value mono">${money(shift.live.netCashSales)}</div></div>
        <div class="stat-card"><div class="label">مصروفات معتمدة خلال الشفت</div><div class="value mono">${money(shift.live.disbursementsTotal)}</div></div>
        <div class="stat-card"><div class="label">الرصيد النقدي المتوقع الآن</div><div class="value mono">${money(shift.live.cashExpected)}</div></div>
        <div class="stat-card"><div class="label">صافي مبيعات الشبكة (متوقع)</div><div class="value mono">${money(shift.live.networkExpected)}</div></div>
      </div>
      <h3 style="font-size:13px; margin:14px 0 8px 0;">مصروفات نقدية معتمدة خلال الشفت</h3>
      ${disbHtml}
      <h3 style="font-size:13px; margin:14px 0 8px 0;">عدّ النقدية حسب الفئة</h3>
      <div id="shDenomRows"></div>
      <div class="lines-total"><span>إجمالي المعدود نقداً</span><span class="mono" id="shDenomSum">0.00</span></div>
      <div class="field" style="margin-top:10px;"><label>مبلغ الشبكة الفعلي (من كشف جهاز الشبكة)</label><input id="shNetworkCounted" type="number" step="0.01" placeholder="0.00"></div>
      <div class="field"><label>ملاحظة</label><input id="shCloseNote" placeholder="اختياري"></div>
      <button class="btn btn-primary" id="shCloseBtn" style="width:100%;">إغلاق الشفت</button>
      <div id="shCloseMsg" class="msg" style="display:none;"></div>
    </div>`;

  const denomRows = document.getElementById('shDenomRows');
  denomRows.innerHTML = denominations.map((v) => `
    <div class="line-row">
      <span style="flex:1;">فئة ${v} ر.س</span>
      <input class="denom-qty-input mono" data-value="${v}" type="number" min="0" step="1" value="0" style="flex:1;">
      <span class="mono denom-line-total" style="flex:1;">0.00</span>
    </div>`).join('');
  function updateDenomSum() {
    let sum = 0;
    denomRows.querySelectorAll('.denom-qty-input').forEach((inp) => {
      const value = Number(inp.dataset.value);
      const qty = Number(inp.value) || 0;
      const lineTotal = value * qty;
      sum += lineTotal;
      inp.closest('.line-row').querySelector('.denom-line-total').textContent = lineTotal.toFixed(2);
    });
    document.getElementById('shDenomSum').textContent = sum.toFixed(2);
    return sum;
  }
  denomRows.querySelectorAll('.denom-qty-input').forEach((inp) => inp.addEventListener('input', updateDenomSum));
  updateDenomSum();

  document.getElementById('shCloseBtn').onclick = async () => {
    const denomValues = {};
    denomRows.querySelectorAll('.denom-qty-input').forEach((inp) => { denomValues[inp.dataset.value] = Number(inp.value) || 0; });
    const networkCounted = document.getElementById('shNetworkCounted').value;
    const note = document.getElementById('shCloseNote').value.trim();
    const msg = document.getElementById('shCloseMsg');
    if (networkCounted === '') { alert('أدخل مبلغ الشبكة الفعلي'); return; }
    if (!confirm('إغلاق الشفت نهائي ولا يمكن التراجع عنه. متابعة؟')) return;
    try {
      const closed = await Api.post(`/pos/shifts/${shift.id}/close`, { denominations: denomValues, networkCounted: parseFloat(networkCounted), note });
      renderShiftReport(closed);
      refreshShiftsView();
    } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; msg.style.display = 'block'; }
  };
}

function varianceColorOf(v) { return Number(v) === 0 ? 'var(--green)' : (Number(v) > 0 ? 'var(--blue)' : 'var(--stamp)'); }
function varianceLabelOf(v) { return Number(v) === 0 ? 'مطابق تماماً' : (Number(v) > 0 ? 'زيادة' : 'عجز'); }

function renderShiftReport(shift) {
  const denominations = shift.denominations || {};
  const denomRowsHtml = Object.entries(denominations).filter(([, qty]) => Number(qty) > 0)
    .map(([value, qty]) => `<tr><td>فئة ${value} ر.س</td><td class="mono">${qty}</td><td class="mono">${(Number(value) * Number(qty)).toFixed(2)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="empty-note">لا يوجد تفصيل فئات</td></tr>';
  const disb = shift.disbursementsList || [];
  const disbRowsHtml = disb.length
    ? disb.map((d) => `<tr><td>${escapeHtml(d.description)}</td><td class="mono">${money(d.amount)}</td><td>${d.receipt_attachment ? `<a href="${d.receipt_attachment}" target="_blank">عرض</a>` : '-'}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-note">لا توجد مصروفات معتمدة خلال هذا الشفت</td></tr>';
  const html = `
    <div class="printable-report">
      <h3 style="margin:0 0 4px 0;">تقرير تصفية شفت — ${escapeHtml(shift.cashier_name)}</h3>
      <div style="font-size:12px; color:var(--muted); margin-bottom:10px;">من ${new Date(shift.opened_at).toLocaleString('ar-SA')} إلى ${new Date(shift.closed_at).toLocaleString('ar-SA')}</div>
      <h3 style="font-size:13px; margin:10px 0 6px 0;">النقدية</h3>
      <div class="stat-cards">
        <div class="stat-card"><div class="label">الرصيد الافتتاحي</div><div class="value mono">${money(shift.opening_float)}</div></div>
        <div class="stat-card"><div class="label">الرصيد النقدي المتوقع</div><div class="value mono">${money(shift.expected_amount)}</div></div>
        <div class="stat-card"><div class="label">المعدود فعلياً</div><div class="value mono">${money(shift.counted_amount)}</div></div>
        <div class="stat-card"><div class="label">فرق النقدية</div><div class="value mono" style="color:${varianceColorOf(shift.variance)};">${money(shift.variance)} (${varianceLabelOf(shift.variance)})</div></div>
      </div>
      <table><thead><tr><th>الفئة</th><th>العدد</th><th>الإجمالي</th></tr></thead><tbody>${denomRowsHtml}</tbody></table>
      <h3 style="font-size:13px; margin:14px 0 6px 0;">الشبكة</h3>
      <div class="stat-cards">
        <div class="stat-card"><div class="label">المتوقع من النظام</div><div class="value mono">${money(shift.network_expected)}</div></div>
        <div class="stat-card"><div class="label">الفعلي من كشف الجهاز</div><div class="value mono">${money(shift.network_counted)}</div></div>
        <div class="stat-card"><div class="label">فرق الشبكة</div><div class="value mono" style="color:${varianceColorOf(shift.network_variance)};">${money(shift.network_variance)} (${varianceLabelOf(shift.network_variance)})</div></div>
      </div>
      <h3 style="font-size:13px; margin:14px 0 6px 0;">مصروفات نقدية معتمدة خلال الشفت (إجمالي ${money(shift.disbursements_total)})</h3>
      <table><thead><tr><th>الوصف</th><th>المبلغ</th><th>المرفق</th></tr></thead><tbody>${disbRowsHtml}</tbody></table>
      ${shift.note ? `<div style="font-size:12.5px; color:var(--muted); margin-top:10px;">ملاحظة: ${escapeHtml(shift.note)}</div>` : ''}
    </div>
    <button class="btn btn-outline" id="shReportPrintBtn" style="margin-top:10px;">طباعة</button>`;
  document.getElementById('countModalContent').innerHTML = html;
  document.getElementById('countModalOverlay').classList.add('open');
  document.getElementById('shReportPrintBtn').onclick = () => window.print();
}

async function renderShiftsHistory(cashierId) {
  const wrap = document.getElementById('shHistoryList');
  wrap.innerHTML = '<div class="empty-note">جارٍ التحميل...</div>';
  const shifts = await Api.get('/pos/shifts?cashierId=' + cashierId);
  const closed = shifts.filter((s) => s.status === 'closed');
  if (closed.length === 0) { wrap.innerHTML = '<div class="empty-note">لا توجد شفتات مغلقة بعد</div>'; return; }
  wrap.innerHTML = '';
  closed.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `<div class="entry-head">
      <div class="eh-left"><span class="eh-date">${new Date(s.opened_at).toLocaleString('ar-SA')}</span><span class="eh-desc">إلى ${new Date(s.closed_at).toLocaleString('ar-SA')}</span></div>
      <span class="eh-total mono" style="color:${varianceColorOf(s.variance)};">${money(s.variance)}</span></div>`;
    card.querySelector('.entry-head').onclick = async () => {
      const detail = await Api.get('/pos/shifts/' + s.id);
      renderShiftReport(detail);
    };
    wrap.appendChild(card);
  });
}
