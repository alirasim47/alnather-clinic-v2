import test from "node:test";
import assert from "node:assert/strict";
import { validateAdminPassword } from "../scripts/password-policy.mjs";

test("rejects the checked-in environment example and other placeholder values", () => {
  assert.match(validateAdminPassword("REPLACE_WITH_A_UNIQUE_RANDOM_PASSWORD"), /placeholder/);
  assert.match(validateAdminPassword("change-me-to-a-real-password"), /placeholder/);
  assert.match(validateAdminPassword("ExampleAdminPassword123!"), /placeholder/);
});

test("requires a long password with at least three character classes", () => {
  assert.match(validateAdminPassword("Short1!Aa"), /16 characters/);
  assert.match(validateAdminPassword("longlowercasepassphraseonly"), /three character classes/);
  assert.equal(validateAdminPassword("OpticClinicSecure-2026!Pass"), null);
});
