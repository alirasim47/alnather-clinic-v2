import { buildPrescriptionHtml } from "@/lib/print-html.mjs";

// ============================================
// ثوابت الأشهر والأيام بالعربية
// ============================================
const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
];

const AR_WEEKDAYS = [
  "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"
];

// ============================================
// تنسيق المبالغ بالدينار العراقي
// ============================================
export const fmtMoney = (n) =>
  new Intl.NumberFormat("ar-IQ", {
    style: "currency",
    currency: "IQD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

// ============================================
// تنسيق التاريخ — يوم شهر سنة (ثابت بأي متصفح)
// ============================================
export const fmtDate = (d) => {
  const date = parseLocalDate(d);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate()} ${AR_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

// ============================================
// تاريخ اليوم بصيغة ISO (YYYY-MM-DD)
// ============================================
export const todayISO = () => {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function parseLocalDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

// ============================================
// التاريخ الطويل — يوم الأسبوع يوم شهر سنة
// ============================================
export const longDate = () => {
  const date = new Date();
  return `${AR_WEEKDAYS[date.getDay()]}، ${date.getDate()} ${AR_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

// ============================================
// بناء رابط واتساب
// ============================================
export function buildWhatsApp({
  phone,
  name,
  date,
  time,
  clinic = "عيادة الناظر",
  countryCode = "964",
  customTemplate = "",
}) {
  const clean = String(phone || "").replace(/\D/g, "");
  const full = clean.startsWith("0") ? countryCode + clean.slice(1) : clean;

  let finalMessage = "";

  if (customTemplate && customTemplate.trim().length > 0) {
    // استبدال المتغيرات في القالب المخصص من الإعدادات
    finalMessage = customTemplate
      .replace(/{name}/g, name || "")
      .replace(/{date}/g, date || "")
      .replace(/{time}/g, time || "")
      .replace(/{clinic}/g, clinic || "");
  } else {
    // الكليشة الافتراضية في حال عدم وجود قالب
    finalMessage = 
      `مرحباً ${name} 👋\n` +
      `نودّ تذكيركم بموعد المراجعة في عيادة *${clinic}* لفحص النظر.\n` +
      `🗓️ التاريخ: ${date}\n⏰ الوقت: ${time}\n` +
      `نسعد بخدمتكم، وفي حال وجود أي استفسار يرجى التواصل معنا.`;
  }

  return `https://wa.me/${full}?text=${encodeURIComponent(finalMessage)}`;
}

// ============================================
// فتح رابط واتساب في نافذة جديدة
// ============================================
export const openWhatsApp = (payload) =>
  window.open(buildWhatsApp(payload), "_blank");

// ============================================
// طباعة وصفة النظر
// ============================================
export function printPrescription({ patient, exam, rx, clinic }) {
  const html = buildPrescriptionHtml({ patient, exam, rx, clinic });
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) {
    window.alert("اسمح بفتح نافذة الطباعة ثم حاول مجددًا.");
    return;
  }
  w.opener = null;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    if (!w.closed) w.print();
  }, 300);
}
