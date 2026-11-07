const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function parseDate(value, label) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw fail(`صيغة تاريخ ${label} غير صالحة؛ استخدم YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw fail(`تاريخ ${label} غير صالح.`);
  }
  return value;
}

function parseCursor(value, from, to) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 512) throw fail("مؤشر صفحة سجل التدقيق غير صالح.");
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const date = new Date(decoded?.createdAt);
    if (!decoded || typeof decoded.id !== "string" || !decoded.id || decoded.id.length > 180 || Number.isNaN(date.valueOf())) {
      throw fail("مؤشر صفحة سجل التدقيق غير صالح.");
    }
    if (decoded.from !== from || decoded.to !== to) throw fail("نطاق التاريخ تغيّر أثناء تصفح سجل التدقيق؛ ابدأ التصدير من جديد.");
    return { createdAt: date.toISOString(), id: decoded.id };
  } catch (error) {
    if (error?.status) throw error;
    throw fail("مؤشر صفحة سجل التدقيق غير صالح.");
  }
}

export function parseAuditQuery(searchParams) {
  const rawLimit = searchParams.get("limit");
  const requestedLimit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw fail("حجم صفحة سجل التدقيق غير صالح.");
  const limit = Math.min(MAX_LIMIT, requestedLimit);
  const from = parseDate(searchParams.get("from"), "البداية");
  const to = parseDate(searchParams.get("to"), "النهاية");
  if (from && to && from > to) throw fail("تاريخ البداية يجب ألا يأتي بعد تاريخ النهاية.");
  const fromAt = from ? `${from}T00:00:00.000Z` : null;
  const toExclusive = to ? new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString() : null;
  const cursor = parseCursor(searchParams.get("cursor"), from, to);
  return { limit, from, to, fromAt, toExclusive, cursor };
}

export function encodeAuditCursor(row, from, to) {
  const createdAt = new Date(row.created_at ?? row.createdAt).toISOString();
  const id = String(row.id ?? "");
  if (!id || id.length > 180) throw fail("تعذر تكوين مؤشر سجل التدقيق.", 500);
  return Buffer.from(JSON.stringify({ createdAt, id, from, to }), "utf8").toString("base64url");
}
