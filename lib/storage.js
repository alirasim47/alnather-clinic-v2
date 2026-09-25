export const DEFAULT_ADMIN_USER = {
  id: 1,
  name: "أبو حسين",
  username: "admin",
  role: "admin",
  active: true,
};

export const DEFAULT_EXAMINER = {
  id: 1,
  name: "أبو حسين",
  phone: "",
  role: "مدير العيادة",
  active: true,
};

export const DEFAULT_CLINIC_SETTINGS = {
  clinicName: "عيادة العلي",
  phone1: "",
  phone2: "",
  footerText: "",
  primaryColor: "#2c1b3d",
  waTemplate: "مرحباً {name} 👋\nنذكركم بموعد المراجعة في عيادة {clinic} بتاريخ {date} الساعة {time}.",
};

export const DEFAULT_BASELINE = {
  patients: [],
  exams: [],
  examiners: [],
  products: [],
  invoices: [],
  followups: [],
  users: [DEFAULT_ADMIN_USER],
  settings: DEFAULT_CLINIC_SETTINGS,
};

export const STORAGE_KEYS = {
  patients: "clinic-patients-v1",
  exams: "clinic-exams-v1",
  examiners: "clinic-examiners-v1",
  products: "clinic-products-v1",
  users: "clinic-users-v1",
  followups: "clinic-followups-v1",
  invoices: "clinic-invoices-v1",
  settings: "clinic-settings-v1",
  auth: "clinic-auth-v1",
};

export function readStorage(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function ensureClinicBaseline() {
  if (typeof window === "undefined") return;

  const collectionKeys = [
    "patients",
    "exams",
    "examiners",
    "products",
    "invoices",
    "followups",
  ];

  collectionKeys.forEach((key) => {
    const value = readStorage(STORAGE_KEYS[key], DEFAULT_BASELINE[key]);
    const safeValue = Array.isArray(value) ? value : [];
    writeStorage(STORAGE_KEYS[key], safeValue);
  });

  const examiners = readStorage(STORAGE_KEYS.examiners, [DEFAULT_EXAMINER]);
  const examinerList = Array.isArray(examiners) && examiners.length > 0 ? examiners : [DEFAULT_EXAMINER];
  writeStorage(STORAGE_KEYS.examiners, examinerList);

  const rawUsers = readStorage(STORAGE_KEYS.users, DEFAULT_BASELINE.users);
  const users = Array.isArray(rawUsers) ? rawUsers.filter(Boolean) : [];
  const adminUser = users.find((user) => String(user?.username || "").toLowerCase() === "admin") || DEFAULT_ADMIN_USER;
  const sanitizedUsers = [
    adminUser,
    ...users.filter((user) => String(user?.username || "").toLowerCase() !== "admin"),
  ];
  writeStorage(STORAGE_KEYS.users, sanitizedUsers);

  const rawSettings = readStorage(STORAGE_KEYS.settings, DEFAULT_CLINIC_SETTINGS);
  const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  writeStorage(STORAGE_KEYS.settings, { ...DEFAULT_CLINIC_SETTINGS, ...settings });

  window.localStorage.removeItem("clinic-notifications-v1");
  // ✅ تم حذف السطر التالي (كان يمسح تسجيل الدخول عند كل تحميل)
  // writeStorage(STORAGE_KEYS.auth, false);
}

export function resetStorage() {
  if (typeof window === "undefined") return;

  Object.values(STORAGE_KEYS).forEach((key) => {
    window.localStorage.removeItem(key);
  });
  window.localStorage.removeItem("clinic-notifications-v1");

  writeStorage(STORAGE_KEYS.users, [DEFAULT_ADMIN_USER]);
  writeStorage(STORAGE_KEYS.examiners, [DEFAULT_EXAMINER]);
  writeStorage(STORAGE_KEYS.settings, DEFAULT_CLINIC_SETTINGS);
  // ✅ هنا يبقى موجود (هذي دالة إعادة تعيين كاملة)
  writeStorage(STORAGE_KEYS.auth, false);

  collectionKeys().forEach((key) => writeStorage(STORAGE_KEYS[key], []));
}

function collectionKeys() {
  return ["patients", "exams", "examiners", "products", "invoices", "followups"];
}
