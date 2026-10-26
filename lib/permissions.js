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
    { id: "invoices.update", label: "تعديل الفاتورة" },
    { id: "invoices.delete", label: "حذف فاتورة" },
    { id: "invoices.print", label: "طباعة فاتورة" },
  ] },
  { id: "products", label: "المنتجات والمخزون", permissions: [
    { id: "products.view", label: "عرض المنتجات والمخزون" },
    { id: "products.create", label: "إضافة منتج" },
    { id: "products.update", label: "تعديل منتج أو كمية" },
    { id: "products.delete", label: "حذف منتج" },
  ] },
  { id: "reports", label: "التقارير", permissions: [
    { id: "reports.view", label: "عرض التقارير" },
    { id: "reports.export", label: "طباعة أو تصدير التقارير" },
  ] },
  { id: "users", label: "الموظفون والصلاحيات", permissions: [{ id: "users.manage", label: "إدارة الموظفين والصلاحيات — المدير فقط" }] },
  { id: "settings", label: "إعدادات العيادة", permissions: [{ id: "settings.manage", label: "تعديل إعدادات العيادة والنسخ الاحتياطي" }] },
];

export const ALL_PERMISSION_IDS = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.id));

const ROLE_PRESETS = {
  admin: ALL_PERMISSION_IDS,
  accountant: ["dashboard.view", "patients.view", "invoices.view", "invoices.create", "invoices.print", "reports.view", "reports.export"],
  receptionist: ["dashboard.view", "patients.view", "patients.create", "patients.update", "followups.view", "followups.update", "followups.delete", "followups.send", "examiners.view"],
  examiner: ["dashboard.view", "patients.view", "exams.view", "exams.create", "exams.update", "exams.print", "followups.view", "examiners.view"],
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
  if (pageId === "dashboard") return hasPermission(user, "dashboard.view");
  if (pageId === "users") return user?.role === "admin";
  if (pageId === "settings") return hasPermission(user, "settings.manage");
  return hasPermission(user, `${pageId}.view`);
}
