import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_HOURS, SESSION_IDLE_MINUTES, SESSION_USER_QUERY } from "../lib/server/session-policy.mjs";

test("session retains a 12-hour absolute lifetime and a 30-minute idle window", () => {
  assert.equal(SESSION_HOURS, 12);
  assert.equal(SESSION_IDLE_MINUTES, 30);
});

test("session lookup enforces both expiry bounds and throttles last_seen writes", () => {
  assert.match(SESSION_USER_QUERY, /s\.expires_at > now\(\)/);
  assert.match(SESSION_USER_QUERY, /s\.last_seen_at > now\(\) - interval '30 minutes'/);
  assert.match(SESSION_USER_QUERY, /last_seen_at <= now\(\) - interval '1 minute'/);
  assert.match(SESSION_USER_QUERY, /u\.active = TRUE/);
});
