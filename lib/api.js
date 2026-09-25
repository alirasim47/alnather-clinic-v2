/**
 * طبقة البيانات — localStorage فقط (بدون سيرفر)
 * تعمل على الجوال والتابلت والكمبيوتر بدون اتصال بالإنترنت
 */
import {
  readStorage,
  writeStorage,
  STORAGE_KEYS,
  DEFAULT_BASELINE,
  DEFAULT_CLINIC_SETTINGS,
  DEFAULT_ADMIN_USER,
  DEFAULT_EXAMINER,
} from "./storage";

const FALLBACKS = {
  patients:  DEFAULT_BASELINE.patients,
  exams:     DEFAULT_BASELINE.exams,
  examiners: [DEFAULT_EXAMINER],
  products:  DEFAULT_BASELINE.products,
  invoices:  DEFAULT_BASELINE.invoices,
  followups: DEFAULT_BASELINE.followups,
  users:     [DEFAULT_ADMIN_USER],
  settings:  DEFAULT_CLINIC_SETTINGS,
};

const getKey      = (name) => STORAGE_KEYS[name] || `clinic-${name}-v1`;
const getFallback = (name, fb) => fb ?? FALLBACKS[name] ?? [];

function notify(collection) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("clinic-data-updated", { detail: { collection } }));
  }
}

/* ─── قراءة مجموعة كاملة ─── */
export async function fetchCollection(name, fallback) {
  const fb   = getFallback(name, fallback);
  const data = readStorage(getKey(name), fb);

  if (name === "settings") {
    return data && typeof data === "object"
      ? { ...DEFAULT_CLINIC_SETTINGS, ...data }
      : fb;
  }
  return Array.isArray(data) ? data : fb;
}

/* ─── حفظ مجموعة كاملة ─── */
export async function saveCollection(name, rows) {
  const safe =
    name === "settings"
      ? { ...DEFAULT_CLINIC_SETTINGS, ...(rows && typeof rows === "object" ? rows : {}) }
      : Array.isArray(rows) ? rows : [];

  writeStorage(getKey(name), safe);
  notify(name);
  return safe;
}

/* ─── حفظ / تحديث عنصر واحد ─── */
export async function saveSingleItem(name, item) {
  if (name === "settings") {
    const current = readStorage(getKey(name), DEFAULT_CLINIC_SETTINGS);
    const merged  = { ...DEFAULT_CLINIC_SETTINGS, ...current, ...(item && typeof item === "object" ? item : {}) };
    writeStorage(getKey(name), merged);
    notify(name);
    return merged;
  }

  const list  = readStorage(getKey(name), []);
  const rows  = Array.isArray(list) ? [...list] : [];
  const index = rows.findIndex((r) => String(r?.id) === String(item?.id));

  if (index >= 0) rows[index] = item;
  else rows.push(item);

  writeStorage(getKey(name), rows);
  notify(name);
  return item;
}

/* ─── حذف عنصر واحد ─── */
export async function deleteSingleItem(name, id) {
  const list = readStorage(getKey(name), []);
  const next = Array.isArray(list) ? list.filter((r) => String(r?.id) !== String(id)) : [];
  writeStorage(getKey(name), next);
  notify(name);
  return next;
}
