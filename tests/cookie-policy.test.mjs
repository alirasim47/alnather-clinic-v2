import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseSecureSessionCookie } from "../lib/server/cookie-policy.mjs";

test("production defaults to a Secure session cookie", () => {
  assert.equal(shouldUseSecureSessionCookie({ nodeEnv: "production" }), true);
  assert.equal(shouldUseSecureSessionCookie({ nodeEnv: "production", cookieSecure: "unset" }), true);
});

test("explicit false is honored for development only", () => {
  assert.equal(shouldUseSecureSessionCookie({ nodeEnv: "development", cookieSecure: "false" }), false);
});

test("production can opt out only for explicit local HTTP loopback origins", () => {
  assert.equal(shouldUseSecureSessionCookie({ nodeEnv: "production", cookieSecure: "false", appOrigin: "http://localhost:3000" }), false);
  assert.equal(shouldUseSecureSessionCookie({ nodeEnv: "production", cookieSecure: "false", appOrigin: "http://127.0.0.1:3000" }), false);
  assert.equal(shouldUseSecureSessionCookie({ nodeEnv: "production", cookieSecure: "false", appOrigin: "http://[::1]:3000" }), false);
  assert.equal(shouldUseSecureSessionCookie({ nodeEnv: "production", cookieSecure: "false", appOrigin: "https://clinic.example.com" }), true);
  assert.equal(shouldUseSecureSessionCookie({ nodeEnv: "production", cookieSecure: "false", appOrigin: "http://clinic.example.com" }), true);
  assert.equal(shouldUseSecureSessionCookie({ nodeEnv: "production", cookieSecure: "false" }), true);
});
