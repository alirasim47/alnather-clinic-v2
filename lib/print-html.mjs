export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

const CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";

function printHead(title) {
  return `<head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;font-family:Tajawal,sans-serif}
    body{margin:24px;color:#1f2937}
    .head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #2c1b3d;padding-bottom:12px}
    .logo{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:800;color:#2c1b3d}
    .logo i{color:#eab308;font-size:26px}
    h2{margin:18px 0 6px;font-size:16px;color:#2c1b3d}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{border:1px solid #d1d5db;padding:8px 10px;text-align:center;font-size:13px}
    th{background:#2c1b3d;color:#fff}
    td.lbl{background:#f3f4f6;font-weight:800}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;font-size:13px}
    .meta div{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:8px}
    .tot{margin-top:14px;font-size:14px}
    .foot{margin-top:28px;font-size:11px;color:#6b7280;text-align:center;border-top:1px dashed #d1d5db;padding-top:10px}
    @media print{.noprint{display:none}}
  </style></head>`;
}

export function buildPrescriptionHtml({ patient, exam, rx, clinic }) {
  const safeText = (value) => escapeHtml(value || "—");
  const row = (label, od = {}, os = {}) => `
    <tr>
      <td class="lbl">${safeText(label)}</td>
      <td>${safeText(od.SPH)}</td><td>${safeText(od.CYL)}</td><td>${safeText(od.AXIS)}</td>
      <td>${safeText(os.SPH)}</td><td>${safeText(os.CYL)}</td><td>${safeText(os.AXIS)}</td>
    </tr>`;

  return `<!doctype html><html dir="rtl" lang="ar">${printHead(`وصفة نظر — ${patient?.name || "—"}`)}<body>
    <div class="head">
      <div class="logo"><i class="fa-solid fa-eye"></i>${safeText(clinic?.name)}</div>
      <div style="font-size:12px;color:#6b7280">${escapeHtml(clinic?.phone || "")}<br>وصفة فحص نظر</div>
    </div>
    <div class="meta">
      <div><b>المريض:</b> ${safeText(patient?.name)}</div>
      <div><b>التاريخ:</b> ${safeText(exam?.date)}</div>
      <div><b>الفاحص:</b> ${safeText(exam?.examiner)}</div>
      <div><b>PD:</b> ${safeText(exam?.pd)}</div>
      <div><b>حدة الإبصار OD/OS:</b> ${safeText(exam?.vaOD)} / ${safeText(exam?.vaOS)}</div>
      <div><b>نوع العدسة:</b> ${safeText(exam?.lens)}</div>
    </div>
    <h2>الرؤية البعيدة (Distance)</h2>
    <table>
      <tr><th rowspan="2">العين</th><th colspan="3">OD — اليمنى</th><th colspan="3">OS — اليسرى</th></tr>
      <tr><th>SPH</th><th>CYL</th><th>AXIS</th><th>SPH</th><th>CYL</th><th>AXIS</th></tr>
      ${row("بعيد", rx?.distance?.OD, rx?.distance?.OS)}
    </table>
    <h2>الرؤية القريبة (Near)</h2>
    <table>
      <tr><th rowspan="2">العين</th><th colspan="3">OD — اليمنى</th><th colspan="3">OS — اليسرى</th></tr>
      <tr><th>SPH</th><th>CYL</th><th>AXIS</th><th>SPH</th><th>CYL</th><th>AXIS</th></tr>
      ${row("قريب", rx?.near?.OD, rx?.near?.OS)}
    </table>
    ${exam?.refraction ? `<h2>نتيجة الانكسار</h2><p style="font-size:13px">${escapeHtml(exam.refraction)}</p>` : ""}
    ${exam?.notes ? `<h2>ملاحظات</h2><p style="font-size:13px">${escapeHtml(exam.notes)}</p>` : ""}
    <div class="foot">تم إصدار هذه الوصفة إلكترونياً بواسطة نظام عيادة الناظر لإدارة فحص النظر والبصريات</div>
  </body></html>`;
}

export function buildInvoiceHtml({ invoice, patientName, clinicName, formatMoney }) {
  const money = (value) => escapeHtml(formatMoney(value));
  const rowsHtml = (invoice.items || []).map((item, index) => `
    <tr><td>${escapeHtml(index + 1)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.qty)}</td><td>${money(item.price)}</td><td>${money(Number(item.price || 0) * Number(item.qty || 0))}</td></tr>`).join("");
  const invoiceNo = escapeHtml(invoice.no);
  const remaining = Math.max(0, (invoice.total || 0) - (invoice.paid || 0) - (invoice.returnedTotal || 0));

  return `<!doctype html><html dir="rtl" lang="ar">${printHead(`فاتورة ${invoice.no ?? ""}`)}<body>
    <div class="head"><h1 style="font-size:20px;color:#2c1b3d;margin:0">${escapeHtml(clinicName)}</h1><div>فاتورة رقم: ${invoiceNo}<br>التاريخ: ${escapeHtml(invoice.date)}</div></div>
    <p><b>المريض:</b> ${escapeHtml(patientName)}</p>
    <table><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>${rowsHtml}</table>
    <div class="tot">
      <p>الإجمالي: <b>${money(invoice.total)}</b></p>
      <p>المدفوع: <b>${money(invoice.paid)}</b></p>
      <p>المتبقي: <b>${money(remaining)}</b></p>
    </div>
    <div class="foot">شكراً لثقتكم — ${escapeHtml(clinicName)}</div>
  </body></html>`;
}
