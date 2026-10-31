import "server-only";
import { hasPermission } from "@/lib/permissions";
import { jsonError } from "./http";

export const COLLECTION_RULES = {
  patients: { view: "patients.view", create: "patients.create", update: "patients.update", delete: "patients.delete" },
  exams: { view: "exams.view", create: "exams.create", update: "exams.update", delete: "exams.delete" },
  examiners: { view: "examiners.view", create: "examiners.create", update: "examiners.update", delete: "examiners.delete" },
  followups: { view: "followups.view", create: "followups.create", update: "followups.update", delete: "followups.delete" },
  products: { view: "products.view", create: "products.create", update: "products.update", delete: "products.delete" },
  invoices: { view: "invoices.view", create: "invoices.create", update: "invoices.update", delete: "invoices.delete" },
  settings: { view: "settings.manage", create: "settings.manage", update: "settings.manage", delete: "settings.manage" },
  branches: { view: "branches.view", create: "branches.create", update: "branches.update", delete: "branches.delete" },
  lensInventory: { view: "lensInventory.view", create: "lensInventory.create", update: "lensInventory.update", delete: "lensInventory.delete" },
  expenses: { view: "expenses.view", create: "expenses.create", update: "expenses.update", delete: "expenses.delete" },
  returns: { view: "returns.view", create: "returns.create", update: "returns.update", delete: "returns.delete" },
  transfers: { view: "transfers.view", create: "transfers.create", update: "transfers.update", delete: "transfers.delete" },
  stockBatches: { view: "products.view", create: "products.update", update: "products.update", delete: "products.update" },
  stockMovements: { view: "products.view" },
  users: { view: "users.manage", create: "users.manage", update: "users.manage", delete: "users.manage" },
};

export function can(user, permission) {
  return hasPermission(user, permission);
}

export function authorize(user, permission) {
  if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
  if (!can(user, permission)) return jsonError("لا تملك صلاحية تنفيذ هذا الإجراء.", 403);
  return null;
}

export function collectionPermission(collection, operation) {
  return COLLECTION_RULES[collection]?.[operation] || null;
}

export function branchScope(user) {
  if (user?.role === "admin") return null;
  return user?.branchId || "__unassigned__";
}
