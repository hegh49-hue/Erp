const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer-core');

async function buildXlsxBuffer({ title, subtitle, columns, rows }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title.slice(0, 31) || 'تقرير');
  sheet.views = [{ rightToLeft: true }];
  if (subtitle) {
    sheet.mergeCells(1, 1, 1, columns.length);
    sheet.getCell(1, 1).value = subtitle;
    sheet.getCell(1, 1).font = { italic: true, color: { argb: 'FF666666' } };
    sheet.addRow([]);
  }
  const headerRow = sheet.addRow(columns.map((c) => c.label));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EDE2' } }; });
  rows.forEach((r) => sheet.addRow(columns.map((c) => r[c.key])));
  sheet.columns.forEach((col) => { col.width = 20; });
  return workbook.xlsx.writeBuffer();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderReportHtml({ title, subtitle, columns, rows, company }) {
  const logoHtml = company?.logo ? `<img src="${company.logo}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;">` : '';
  const headCells = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const bodyRows = rows.map((r) => `<tr>${columns.map((c) => `<td>${escapeHtml(r[c.key])}</td>`).join('')}</tr>`).join('');
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<style>
  body{font-family:'Tajawal','Segoe UI',sans-serif; padding:24px; color:#1B1A17;}
  header{display:flex; align-items:center; gap:12px; border-bottom:2px solid #2C5A7A; padding-bottom:12px; margin-bottom:16px;}
  .company-name{font-weight:800; font-size:16px;}
  h1{font-size:16px; margin:0 0 4px 0;}
  .subtitle{color:#8A8375; font-size:12px; margin-bottom:16px;}
  table{width:100%; border-collapse:collapse; font-size:11.5px;}
  th,td{border:1px solid #DBD5C4; padding:6px 8px; text-align:right;}
  th{background:#F1EDE2; font-weight:700;}
</style></head>
<body>
  <header>${logoHtml}<div class="company-name">${escapeHtml(company?.name || '')}</div></header>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
  <table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>
</body></html>`;
}

async function buildPdfBuffer({ title, subtitle, columns, rows, company }) {
  const executablePath = process.env.CHROMIUM_PATH;
  if (!executablePath) throw new Error('CHROMIUM_PATH غير مُهيّأ على الخادم — تصدير PDF غير متاح');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderReportHtml({ title, subtitle, columns, rows, company }), { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' } });
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { buildXlsxBuffer, buildPdfBuffer };
