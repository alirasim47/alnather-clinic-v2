export const PERMISSION_GROUPS = [
  { id: "dashboard", label: "لوحة التحكم", permissions: [{ id: "dashboard.view", label: "عرض لوحة التحكم" }] },
  { id: "patients", label: "المرضى", permissions: [
    { id: "patients.view", label: "عرض المرضى والملفات" },
    { id: "patients.create", label: "إضافة مريض" },
    { id: "patients.update", label: "تعديل بيانات المريض" },
    { id: "patients.delete", label: "حذف مريض" },
  ] },
  { id: "exams", label: "الفحوصات والوصفات", permissions: [
    { id: "exams.view", label: "عرض الفحوصات" },
    { id: "exams.create", label: "إضافة فحص" },
    { id: "exams.update", label: "تعديل فحص" },
    { id: "exams.delete", label: "حذف فحص" },
    { id: "exams.print", label: "طباعة الوصفات" },
  ] },
  { id: "followups", label: "المواعيد والمراجعات", permissions: [
    { id: "followups.view", label: "عرض المواعيد" },
    { id: "followups.create", label: "إضافة موعد" },
    { id: "followups.update", label: "تعديل الموعد / تحديده كمكتمل" },
    { id: "followups.delete", label: "حذف موعد" },
    { id: "followups.send", label: "إرسال تذكير واتساب" },
  ] },
  { id: "examiners", label: "الفاحصون والكادر", permissions: [
    { id: "examiners.view", label: "عرض قائمة الفاحصين" },
    { id: "examiners.create", label: "إضافة فاحص" },
    { id: "examiners.update", label: "تعديل الفاحص أو حالته" },
    { id: "examiners.delete", label: "حذف فاحص" },
  ] },
  { id: "invoices", label: "الفواتير والمبيعات", permissions: [
    { id: "invoices.view", label: "عرض الفواتير" },
    { id: "invoices.create", label: "إنشاء فاتورة" },
    { id: "invoices.update", label: "تسجيل دفعة على فاتورة" },
    { id: "invoices.delete", label: "إلغاء فاتورة غير معتمدة" },
    { id: "invoices.print", label: "طباعة فاتورة" },
  ] },
  { id: "products", label: "المنتجات والدفعات", permissions: [
    { id: "products.view", label: "عرض المنتجات والمخزون" },
    { id: "products.create", label: "إضافة منتج" },
    { id: "products.update", label: "تعديل منتج أو كمية" },
    { id: "products.delete", label: "تعطيل منتج" },
  ] },
  { id: "lensInventory", label: "مخزون العدسات بالقياس", permissions: [
    { id: "lensInventory.view", label: "عرض قياسات وأرصدة العدسات" },
    { id: "lensInventory.create", label: "إضافة رصيد عدسات" },
    { id: "lensInventory.update", label: "تعديل قياس أو رصيد العدسة" },
    { id: "lensInventory.delete", label: "تعطيل قياس عدسة" },
  ] },
  { id: "branches", label: "الفروع", permissions: [
    { id: "branches.view", label: "عرض الفروع وأرصدتها" },
    { id: "branches.create", label: "إضافة فرع" },
    { id: "branches.update", label: "تعديل فرع" },
    { id: "branches.delete", label: "تعطيل فرع" },
  ] },
  { id: "transfers", label: "نقل المخزون", permissions: [
    { id: "transfers.view", label: "عرض طلبات النقل" },
    { id: "transfers.create", label: "إنشاء طلب نقل" },
    { id: "transfers.update", label: "تأكيد استلام أو رفض النقل" },
    { id: "transfers.delete", label: "إلغاء طلب نقل معلّق" },
  ] },
  { id: "expenses", label: "المصاريف", permissions: [
    { id: "expenses.view", label: "عرض المصاريف" },
    { id: "expenses.create", label: "إضافة مصروف" },
    { id: "expenses.update", label: "تعديل مصروف" },
    { id: "expenses.delete", label: "حذف مصروف" },
  ] },
  { id: "returns", label: "العوائد", permissions: [
    { id: "returns.view", label: "عرض العوائد" },
    { id: "returns.create", label: "تسجيل عائد" },
    { id: "returns.update", label: "تعديل عائد غير معتمد" },
    { id: "returns.delete", label: "إلغاء عائد" },
  ] },
  { id: "reports", label: "التقارير", permissions: [
    { id: "reports.view", label: "عرض التقارير التشغيلية" },
    { id: "reports.financial", label: "عرض الأرباح والمصاريف" },
    { id: "reports.export", label: "طباعة أو تصدير التقارير" },
  ] },
  { id: "users", label: "الموظفون والصلاحيات", permissions: [{ id: "users.manage", label: "إدارة الموظفين والصلاحيات — المدير فقط" }] },
  { id: "settings", label: "إعدادات العيادة", permissions: [{ id: "settings.manage", label: "تعديل إعدادات العيادة والنسخ الاحتياطي" }] },
];

export const ALL_PERMISSION_IDS = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.id));

const ROLE_PRESETS = {
  admin: ALL_PERMISSION_IDS,
  accountant: [
    "dashboard.view", "patients.view", "invoices.view", "invoices.create", "invoices.update", "invoices.print",
    "products.view", "lensInventory.view", "branches.view", "transfers.view", "expenses.view", "expenses.create",
    "expenses.update", "returns.view", "returns.create", "reports.view", "reports.financial", "reports.export",
  ],
  receptionist: [
    "dashboard.view", "patients.view", "patients.create", "patients.update", "followups.view", "followups.create",
    "followups.update", "followups.delete", "followups.send", "examiners.view", "invoices.view", "invoices.create",
    "invoices.print", "products.view", "lensInventory.view",
  ],
  examiner: [
    "dashboard.view", "patients.view", "exams.view", "exams.create", "exams.update", "exams.print",
    "followups.view", "followups.create", "followups.update", "examiners.view",
  ],
  storekeeper: [
    "dashboard.view", "products.view", "products.create", "products.update", "products.delete",
    "lensInventory.view", "lensInventory.create", "lensInventory.update", "lensInventory.delete",
    "branches.view", "transfers.view", "transfers.create", "transfers.update", "transfers.delete",
    "returns.view", "returns.create", "reports.view",
  ],
};

export function permissionsForRole(role) {
  const allowed = new Set(ROLE_PRESETS[role] || ROLE_PRESETS.receptionist);
  return Object.fromEntries(ALL_PERMISSION_IDS.map((id) => [id, allowed.has(id)]));
}

export function normalizePermissions(user) {
  if (!user) return permissionsForRole("receptionist");
  if (user.role === "admin") return permissionsForRole("admin");
  const defaults = permissionsForRole(user.role);
  const overrides = user.permissions && typeof user.permissions === "object" ? user.permissions : {};
  return Object.fromEntries(ALL_PERMISSION_IDS.map((id) => [
    id,
    id === "users.manage" ? false : (typeof overrides[id] === "boolean" ? overrides[id] : defaults[id]),
  ]));
}

export function hasPermission(user, permissionId) {
  if (!user) return false;
  if (permissionId === "users.manage") return user.role === "admin";
  if (user.role === "admin") return true;
  return normalizePermissions(user)[permissionId] === true;
}

export function canViewPage(user, pageId) {
  const pagePermissions = {
    dashboard: "dashboard.view",
    patients: "patients.view",
    followups: "followups.view",
    examiners: "examiners.view",
    invoices: "invoices.view",
    products: "products.view",
    lensInventory: "lensInventory.view",
    branches: "branches.view",
    expenses: "expenses.view",
    returns: "returns.view",
    reports: "reports.view",
    users: "users.manage",
    settings: "settings.manage",
  };
  return hasPermission(user, pagePermissions[pageId] || `${pageId}.view`);
}
