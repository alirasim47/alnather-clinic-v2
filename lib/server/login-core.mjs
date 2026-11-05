import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

export const LOGIN_FAILURE_MESSAGE = "اسم المستخدم أو كلمة المرور غير صحيحة.";
export const RATE_LIMIT_MESSAGE = "محاولات كثيرة. انتظر قليلًا ثم حاول من جديد.";
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const USER_MAX_FAILURES = 8;
export const IP_CLINIC_MAX_FAILURES = 30;

// Generate with the same bcrypt cost as password hashes; never use a guessed literal hash.
export const DUMMY_PASSWORD_HASH_PROMISE = bcrypt.hash("alnather-dummy-login-secret-never-valid", 12);

const clean = (value, max = 120) => String(value ?? "").trim().slice(0, max);
const normalizePhone = (value) => String(value ?? "").replace(/[^0-9+]/g, "");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function parseLoginInput(body) {
  const identifier = clean(body?.identifier, 120).toLowerCase();
  const password = String(body?.password ?? "");
  const clinicSlug = clean(body?.clinicSlug, 50).toLowerCase();
  if (!clinicSlug || !identifier || !password) {
    return { error: { status: 400, message: "أدخل رمز العيادة واسم المستخدم وكلمة المرور." } };
  }
  return { input: { clinicSlug, identifier, phone: normalizePhone(identifier), password } };
}

export function getLoginClientIp(request) {
  // These headers must be set/overwritten by the trusted hosting reverse proxy.
  const realIp = clean(request.headers.get("x-real-ip"), 80);
  const forwardedIp = clean(request.headers.get("x-forwarded-for")?.split(",")[0], 80);
  return realIp || forwardedIp || "unknown";
}

function rateBucketHash(kind, clinicSlug, value) {
  return sha256(`${kind}|${clinicSlug}|${value}`);
}

async function getRateBucket(client, bucketHash, now) {
  await client.query(
    `INSERT INTO login_attempts(bucket_hash, attempts, window_started_at)
     VALUES ($1, 0, now()) ON CONFLICT (bucket_hash) DO NOTHING`,
    [bucketHash],
  );
  let row = (await client.query(
    "SELECT attempts, window_started_at, blocked_until FROM login_attempts WHERE bucket_hash = $1 FOR UPDATE",
    [bucketHash],
  )).rows[0];
  if (row.blocked_until && new Date(row.blocked_until).getTime() > now) return { blocked: true, attempts: Number(row.attempts || 0) };
  if (now - new Date(row.window_started_at).getTime() > LOGIN_WINDOW_MS) {
    await client.query(
      "UPDATE login_attempts SET attempts = 0, blocked_until = NULL, window_started_at = now(), updated_at = now() WHERE bucket_hash = $1",
      [bucketHash],
    );
    row = { ...row, attempts: 0, blocked_until: null };
  }
  return { blocked: false, attempts: Number(row.attempts || 0) };
}

async function recordFailure(client, bucketHash, bucket, maxAttempts, now) {
  const attempts = bucket.attempts + 1;
  const blockedUntil = attempts >= maxAttempts ? new Date(now + LOGIN_WINDOW_MS) : null;
  await client.query(
    "UPDATE login_attempts SET attempts = $2, blocked_until = $3, updated_at = now() WHERE bucket_hash = $1",
    [bucketHash, attempts, blockedUntil],
  );
  return Boolean(blockedUntil);
}

export async function authenticateLogin({
  client,
  input,
  ipAddress,
  createSession,
  comparePassword = bcrypt.compare,
  now = Date.now(),
}) {
  const { clinicSlug, identifier, phone, password } = input;
  // Retain the established per-identifier key while adding a separate per-IP/per-clinic bucket.
  const userBucketHash = sha256(`${clinicSlug}|${identifier}`);
  const ipBucketHash = rateBucketHash("ip-clinic", clinicSlug, ipAddress || "unknown");
  const userBucket = await getRateBucket(client, userBucketHash, now);
  const ipBucket = await getRateBucket(client, ipBucketHash, now);
  if (userBucket.blocked || ipBucket.blocked) {
    return { status: 429, message: RATE_LIMIT_MESSAGE };
  }

  const userRows = await client.query(
    `SELECT u.*, c.name AS clinic_name, c.slug AS clinic_slug, b.name AS branch_name
       FROM app_users u
       JOIN clinics c ON c.id = u.clinic_id
       LEFT JOIN branches b ON b.id = u.branch_id AND b.clinic_id = u.clinic_id
      WHERE c.slug = $1
        AND (u.username_normalized = $2 OR ($3 <> '' AND regexp_replace(coalesce(u.phone, ''), '[^0-9+]', '', 'g') = $3))
      ORDER BY u.created_at ASC LIMIT 3 FOR UPDATE OF u`,
    [clinicSlug, identifier, phone],
  );

  // Ambiguous cross-field matches fail closed; username/phone aliases must resolve to one account.
  const user = userRows.rowCount === 1 ? userRows.rows[0] : null;
  const passwordHash = user?.password_hash || await DUMMY_PASSWORD_HASH_PROMISE;
  const validPassword = await comparePassword(password, passwordHash);
  const accountLocked = user?.locked_until && new Date(user.locked_until).getTime() > now;

  if (!user || !user.active || !validPassword || accountLocked) {
    if (user && !validPassword) {
      await client.query(
        `UPDATE app_users
            SET failed_login_count = failed_login_count + 1,
                locked_until = CASE WHEN failed_login_count >= 7 THEN now() + interval '15 minutes' ELSE locked_until END
          WHERE id = $1 AND clinic_id = $2`,
        [user.id, user.clinic_id],
      );
    }
    const userBlocked = await recordFailure(client, userBucketHash, userBucket, USER_MAX_FAILURES, now);
    const ipBlocked = await recordFailure(client, ipBucketHash, ipBucket, IP_CLINIC_MAX_FAILURES, now);
    return userBlocked || ipBlocked
      ? { status: 429, message: RATE_LIMIT_MESSAGE }
      : { status: 401, message: LOGIN_FAILURE_MESSAGE };
  }

  await client.query(
    "UPDATE app_users SET failed_login_count = 0, locked_until = NULL WHERE id = $1 AND clinic_id = $2",
    [user.id, user.clinic_id],
  );
  await client.query(
    "UPDATE login_attempts SET attempts = 0, blocked_until = NULL, window_started_at = now(), updated_at = now() WHERE bucket_hash = $1",
    [userBucketHash],
  );
  const token = await createSession(client, user);
  await client.query(
    `INSERT INTO audit_events(id, clinic_id, actor_id, action, summary, metadata)
     VALUES ($1, $2, $3, 'auth.login', 'تسجيل دخول ناجح', '{}'::jsonb)`,
    [randomUUID(), user.clinic_id, user.id],
  );
  return { status: 200, token, user };
}
