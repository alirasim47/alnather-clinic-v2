import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  authenticateLogin,
  DUMMY_PASSWORD_HASH_PROMISE,
  IP_CLINIC_MAX_FAILURES,
  LOGIN_FAILURE_MESSAGE,
  parseLoginInput,
} from "../lib/server/login-core.mjs";

const NOW = Date.now();

class FakeClient {
  constructor(users = []) {
    this.users = users.map((user) => ({
      active: true,
      failed_login_count: 0,
      locked_until: null,
      branch_id: null,
      branch_name: null,
      clinic_name: `Clinic ${user.clinic_id}`,
      clinic_slug: user.clinic_id.toLowerCase(),
      ...user,
    }));
    this.buckets = new Map();
    this.auditEvents = [];
  }

  async query(sql, values = []) {
    const statement = sql.replace(/\s+/g, " ").trim();
    if (statement.startsWith("INSERT INTO login_attempts")) {
      const [hash] = values;
      if (!this.buckets.has(hash)) {
        this.buckets.set(hash, { attempts: 0, window_started_at: new Date(NOW), blocked_until: null });
      }
      return { rowCount: 1, rows: [] };
    }
    if (statement.startsWith("SELECT attempts, window_started_at, blocked_until FROM login_attempts")) {
      const row = this.buckets.get(values[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
    }
    if (statement.startsWith("UPDATE login_attempts SET attempts = 0")) {
      const row = this.buckets.get(values[0]);
      if (row) Object.assign(row, { attempts: 0, blocked_until: null, window_started_at: new Date(NOW) });
      return { rowCount: row ? 1 : 0, rows: [] };
    }
    if (statement.startsWith("UPDATE login_attempts SET attempts = $2")) {
      const [hash, attempts, blockedUntil] = values;
      const row = this.buckets.get(hash);
      if (row) Object.assign(row, { attempts, blocked_until: blockedUntil });
      return { rowCount: row ? 1 : 0, rows: [] };
    }
    if (statement.startsWith("SELECT u.*, c.name AS clinic_name")) {
      const [clinicSlug, identifier, phone] = values;
      const rows = this.users.filter((user) => user.clinic_slug === clinicSlug && (
        user.username_normalized === identifier
        || (phone !== "" && String(user.phone || "").replace(/[^0-9+]/g, "") === phone)
      ));
      return { rowCount: rows.length, rows: rows.slice(0, 3).map((row) => ({ ...row })) };
    }
    if (statement.startsWith("UPDATE app_users SET failed_login_count = failed_login_count + 1")) {
      const [id, clinicId] = values;
      const row = this.users.find((user) => user.id === id && user.clinic_id === clinicId);
      if (row) row.failed_login_count += 1;
      return { rowCount: row ? 1 : 0, rows: [] };
    }
    if (statement.startsWith("UPDATE app_users SET failed_login_count = 0")) {
      const [id, clinicId] = values;
      const row = this.users.find((user) => user.id === id && user.clinic_id === clinicId);
      if (row) Object.assign(row, { failed_login_count: 0, locked_until: null });
      return { rowCount: row ? 1 : 0, rows: [] };
    }
    if (statement.startsWith("INSERT INTO audit_events")) {
      this.auditEvents.push(values);
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected SQL in FakeClient: ${statement}`);
  }
}

async function passwordHash(password) {
  return bcrypt.hash(password, 12);
}

function makeUser({ id, clinicId, slug, username, passwordHash: hash, phone = "", extra = {} }) {
  return {
    id,
    clinic_id: clinicId,
    clinic_slug: slug,
    clinic_name: `Clinic ${clinicId}`,
    branch_id: null,
    branch_name: null,
    name: username,
    username,
    username_normalized: username,
    phone,
    password_hash: hash,
    role: "admin",
    permissions: {},
    active: true,
    must_change_password: false,
    locked_until: null,
    ...extra,
  };
}

function inputFor({ clinicSlug = "clinic-a", identifier = "alice", password = "secret-A" } = {}) {
  const parsed = parseLoginInput({ clinicSlug, identifier, password });
  assert.ok(parsed.input, parsed.error?.message);
  return parsed.input;
}

async function login(client, input, { ipAddress = "192.0.2.10", comparePassword, sessions = [] } = {}) {
  return authenticateLogin({
    client,
    input,
    ipAddress,
    comparePassword,
    now: NOW,
    createSession: async (_client, user) => {
      sessions.push({ clinicId: user.clinic_id, userId: user.id });
      return `token-${user.id}`;
    },
  });
}

test("clinic slug is required and normalized before lookup", () => {
  const missing = parseLoginInput({ clinicSlug: "  ", identifier: "alice", password: "pw" });
  assert.equal(missing.error.status, 400);
  assert.equal(missing.error.message, "أدخل رمز العيادة واسم المستخدم وكلمة المرور.");
  assert.deepEqual(parseLoginInput({ clinicSlug: "  CLINIC-A ", identifier: " Alice ", password: "pw" }).input, {
    clinicSlug: "clinic-a", identifier: "alice", phone: "", password: "pw",
  });
});

test("wrong clinic, missing user, and wrong password return the same 401; missing users use the dummy bcrypt hash", async () => {
  const hashA = await passwordHash("secret-A");
  const user = makeUser({ id: "user-a", clinicId: "clinic-A", slug: "clinic-a", username: "alice", passwordHash: hashA });
  const dummyHash = await DUMMY_PASSWORD_HASH_PROMISE;
  const compareCalls = [];
  const comparePassword = async (password, hash) => {
    compareCalls.push(hash);
    return bcrypt.compare(password, hash);
  };

  const wrongClinic = await login(new FakeClient([user]), inputFor({ clinicSlug: "clinic-x" }), { comparePassword, ipAddress: "192.0.2.11" });
  const missingUser = await login(new FakeClient([user]), inputFor({ identifier: "nobody" }), { comparePassword, ipAddress: "192.0.2.12" });
  const wrongPassword = await login(new FakeClient([user]), inputFor({ password: "incorrect" }), { comparePassword, ipAddress: "192.0.2.13" });

  for (const result of [wrongClinic, missingUser, wrongPassword]) {
    assert.equal(result.status, 401);
    assert.equal(result.message, LOGIN_FAILURE_MESSAGE);
  }
  assert.equal(compareCalls.length, 3);
  assert.equal(compareCalls[0], dummyHash);
  assert.equal(compareCalls[1], dummyHash);
  assert.equal(compareCalls[2], hashA);
});

test("the same username in two clinics authenticates only within the supplied clinic and session carries its clinic_id", async () => {
  const users = [
    makeUser({ id: "user-a", clinicId: "clinic-A", slug: "clinic-a", username: "shared", passwordHash: await passwordHash("password-A") }),
    makeUser({ id: "user-b", clinicId: "clinic-B", slug: "clinic-b", username: "shared", passwordHash: await passwordHash("password-B") }),
  ];
  const sessionsA = [];
  const successA = await login(new FakeClient(users), inputFor({ clinicSlug: " CLINIC-A ", identifier: "shared", password: "password-A" }), { sessions: sessionsA, ipAddress: "192.0.2.20" });
  assert.equal(successA.status, 200);
  assert.deepEqual(sessionsA, [{ clinicId: "clinic-A", userId: "user-a" }]);

  const wrongClinicPassword = await login(new FakeClient(users), inputFor({ clinicSlug: "clinic-b", identifier: "shared", password: "password-A" }), { ipAddress: "192.0.2.21" });
  assert.equal(wrongClinicPassword.status, 401);
  assert.equal(wrongClinicPassword.message, LOGIN_FAILURE_MESSAGE);

  const sessionsB = [];
  const successB = await login(new FakeClient(users), inputFor({ clinicSlug: "clinic-b", identifier: "shared", password: "password-B" }), { sessions: sessionsB, ipAddress: "192.0.2.22" });
  assert.equal(successB.status, 200);
  assert.deepEqual(sessionsB, [{ clinicId: "clinic-B", userId: "user-b" }]);
});

test("phone number remains a supported login identifier after normalization", async () => {
  const user = makeUser({
    id: "phone-user",
    clinicId: "clinic-A",
    slug: "clinic-a",
    username: "phone-user",
    phone: "+1 (555) 123-4567",
    passwordHash: await passwordHash("phone-password"),
  });
  const result = await login(
    new FakeClient([user]),
    inputFor({ identifier: "+1 555 123 4567", password: "phone-password" }),
    { ipAddress: "192.0.2.25" },
  );
  assert.equal(result.status, 200);
  assert.equal(result.user.id, "phone-user");
});

test("locked and disabled accounts use the same generic 401 response", async () => {
  const hash = await passwordHash("secret-A");
  const locked = makeUser({ id: "locked", clinicId: "clinic-A", slug: "clinic-a", username: "locked", passwordHash: hash, extra: { locked_until: new Date(NOW + 60_000) } });
  const disabled = makeUser({ id: "disabled", clinicId: "clinic-A", slug: "clinic-a", username: "disabled", passwordHash: hash, extra: { active: false } });
  const results = await Promise.all([
    login(new FakeClient([locked]), inputFor({ identifier: "locked" }), { ipAddress: "192.0.2.30" }),
    login(new FakeClient([disabled]), inputFor({ identifier: "disabled" }), { ipAddress: "192.0.2.31" }),
  ]);
  assert.deepEqual(results.map(({ status, message }) => ({ status, message })), [
    { status: 401, message: LOGIN_FAILURE_MESSAGE },
    { status: 401, message: LOGIN_FAILURE_MESSAGE },
  ]);
});

test("empty phone normalization does not match users with no phone; ambiguous aliases fail closed", async () => {
  const hash = await passwordHash("secret-A");
  const user = makeUser({ id: "user-a", clinicId: "clinic-A", slug: "clinic-a", username: "other", passwordHash: hash });
  const noPhoneMatch = await login(new FakeClient([user]), inputFor({ identifier: "absent" }), { ipAddress: "192.0.2.40" });
  assert.equal(noPhoneMatch.status, 401);

  const first = makeUser({ id: "one", clinicId: "clinic-A", slug: "clinic-a", username: "555123", passwordHash: hash });
  const second = makeUser({ id: "two", clinicId: "clinic-A", slug: "clinic-a", username: "other", phone: "555123", passwordHash: hash });
  const ambiguous = await login(new FakeClient([first, second]), inputFor({ identifier: "555123", password: "secret-A" }), { ipAddress: "192.0.2.41" });
  assert.equal(ambiguous.status, 401);
  assert.equal(ambiguous.message, LOGIN_FAILURE_MESSAGE);
});

test("IP plus clinic rate limit spans different usernames using the existing PostgreSQL bucket table", async () => {
  const client = new FakeClient();
  const comparePassword = async () => false;
  let last;
  for (let i = 0; i < IP_CLINIC_MAX_FAILURES; i += 1) {
    last = await login(client, inputFor({ identifier: `unknown-${i}` }), { comparePassword, ipAddress: "198.51.100.9" });
  }
  assert.equal(last.status, 429);
  assert.equal(client.buckets.size, IP_CLINIC_MAX_FAILURES + 1);
  const blocked = await login(client, inputFor({ identifier: "another-user" }), { comparePassword, ipAddress: "198.51.100.9" });
  assert.equal(blocked.status, 429);
  const otherIp = await login(client, inputFor({ identifier: "another-user" }), { comparePassword, ipAddress: "198.51.100.10" });
  assert.equal(otherIp.status, 401);
});
