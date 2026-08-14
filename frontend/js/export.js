/**
 * Shared "تصدير Excel / تصدير PDF" component. Any report screen calls
 * renderExportButtons(containerId, dataProviderFn) where dataProviderFn()
 * returns { title, subtitle, columns:[{key,label}], rows:[{...}] } built
 * from whatever is currently rendered — this is the standing convention for
 * every report in the app, existing or future.
 */
async function exportReport(format, dataProviderFn) {
  const data = dataProviderFn();
  if (!data || !data.rows || data.rows.length === 0) { alert('لا توجد بيانات لتصديرها'); return; }
  try {
    const res = await fetch(`/api/export/${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Api.token}` },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'فشل التصدير');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${data.title}.${format}`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('تعذّر الاتصال بالخادم للتصدير');
  }
}

function renderExportButtons(containerId, dataProviderFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <button class="btn btn-outline btn-sm export-xlsx-btn">⬇ تصدير Excel</button>
    <button class="btn btn-outline btn-sm export-pdf-btn">⬇ تصدير PDF</button>`;
  el.querySelector('.export-xlsx-btn').onclick = () => exportReport('xlsx', dataProviderFn);
  el.querySelector('.export-pdf-btn').onclick = () => exportReport('pdf', dataProviderFn);
}
