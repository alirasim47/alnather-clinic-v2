import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getSecurityHeaders } = require("../lib/security-headers.cjs");
const byName = (headers) => Object.fromEntries(headers.map(({ key, value }) => [key, value]));

test("production headers include CSP and standard protections with HSTS", () => {
  const headers = byName(getSecurityHeaders("production"));
  const csp = headers["Content-Security-Policy"];

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /https:\/\/fonts\.gstatic\.com/);
  assert.match(csp, /https:\/\/cdnjs\.cloudflare\.com/);
  assert.match(csp, /img-src 'self' data: blob: https:/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["Permissions-Policy"], "camera=(), microphone=(), geolocation=()");
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000");
});

test("development permits Next dev tooling and omits HSTS/frame denial for local preview", () => {
  const headers = byName(getSecurityHeaders("development"));
  const csp = headers["Content-Security-Policy"];

  assert.match(csp, /'unsafe-eval'/);
  assert.match(csp, /connect-src 'self' ws: wss:/);
  assert.doesNotMatch(csp, /frame-ancestors/);
  assert.equal(headers["Strict-Transport-Security"], undefined);
  assert.equal(headers["X-Frame-Options"], undefined);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});
