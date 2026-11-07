import test from "node:test";
import assert from "node:assert/strict";
import { hasPermission, normalizePermissions } from "../lib/permissions.js";

test("audit.view is strictly restricted to admins even if another role submits an override", () => {
  const forgedStaff = { role: "accountant", permissions: { "audit.view": true } };
  assert.equal(hasPermission(forgedStaff, "audit.view"), false);
  assert.equal(normalizePermissions(forgedStaff)["audit.view"], false);
  assert.equal(hasPermission({ role: "admin" }, "audit.view"), true);
});
