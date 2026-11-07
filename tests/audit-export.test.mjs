import test from "node:test";
import assert from "node:assert/strict";
import { encodeAuditCursor, parseAuditQuery } from "../lib/server/audit-export.mjs";

const params = (values = {}) => new URLSearchParams(values);

test("uses bounded default and maximum audit page sizes", () => {
  assert.equal(parseAuditQuery(params()).limit, 500);
  assert.equal(parseAuditQuery(params({ limit: "9000" })).limit, 500);
  assert.throws(() => parseAuditQuery(params({ limit: "0" })), /حجم صفحة/);
});

test("validates dates and includes the full end date in UTC", () => {
  const parsed = parseAuditQuery(params({ from: "2026-01-02", to: "2026-01-02" }));
  assert.equal(parsed.fromAt, "2026-01-02T00:00:00.000Z");
  assert.equal(parsed.toExclusive, "2026-01-03T00:00:00.000Z");
  assert.throws(() => parseAuditQuery(params({ from: "2026-02-30" })), /تاريخ البداية غير صالح/);
  assert.throws(() => parseAuditQuery(params({ from: "2026-02-03", to: "2026-02-02" })), /تاريخ البداية/);
});

test("round-trips keyset cursors only under the same date range", () => {
  const first = parseAuditQuery(params({ from: "2026-01-01", to: "2026-01-31" }));
  const cursor = encodeAuditCursor({ created_at: new Date("2026-01-20T12:00:00.000Z"), id: "event-1" }, first.from, first.to);
  const next = parseAuditQuery(params({ from: first.from, to: first.to, cursor }));
  assert.deepEqual(next.cursor, { createdAt: "2026-01-20T12:00:00.000Z", id: "event-1" });
  assert.throws(() => parseAuditQuery(params({ from: "2026-01-01", to: "2026-01-30", cursor })), /نطاق التاريخ تغيّر/);
});
