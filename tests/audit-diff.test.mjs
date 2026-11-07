import test from "node:test";
import assert from "node:assert/strict";
import { auditSnapshot } from "../lib/server/audit-diff.mjs";

test("audit updates store only changed top-level fields with stable object comparison", () => {
  const result = auditSnapshot(
    { name: "A", address: { city: "Baghdad", street: "1" }, unchanged: [1, 2] },
    { name: "B", address: { city: "Baghdad", street: "2" }, unchanged: [1, 2] },
  );
  assert.deepEqual(result, {
    before: { name: "A", address: { city: "Baghdad", street: "1" } },
    after: { name: "B", address: { city: "Baghdad", street: "2" } },
  });
});

test("audit create/delete snapshots retain JSON data but omit embedded base64 payloads", () => {
  const created = auditSnapshot(null, { name: "Clinic", logo: "data:image/png;base64,AAAA" });
  assert.equal(created.before, null);
  assert.deepEqual(created.after.logo, { omitted: "embedded-binary", characterCount: 26 });
  assert.deepEqual(auditSnapshot({ name: "Clinic" }, null), { before: { name: "Clinic" }, after: null });
});
