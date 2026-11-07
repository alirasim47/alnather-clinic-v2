import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "./db";
import { shouldUseSecureSessionCookie } from "./cookie-policy.mjs";
import { SESSION_HOURS, SESSION_USER_QUERY } from "./session-policy.mjs";

export const SESSION_COOKIE = "clinic_session";
export { SESSION_HOURS };

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function getCookieValue(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try { return decodeURIComponent(value.join("=")); } catch { return value.join("="); }
    }
  }
  return "";
}

export function cookieOptions() {
  const secure = shouldUseSecureSessionCookie({
    nodeEnv: process.env.NODE_ENV,
    cookieSecure: process.env.COOKIE_SECURE,
    appOrigin: process.env.APP_ORIGIN,
  });
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  };
}

export function safeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    phone: row.phone || "",
    role: row.role,
    active: row.active !== false,
    permissions: row.permissions && typeof row.permissions === "object" ? row.permissions : {},
    branchId: row.branch_id || row.branchId || null,
    branchName: row.branch_name || row.branchName || "",
    clinicId: row.clinic_id || row.clinicId,
    clinicName: row.clinic_name || row.clinicName || "",
    clinicSlug: row.clinic_slug || row.clinicSlug || "",
    mustChangePassword: Boolean(row.must_change_password ?? row.mustChangePassword),
  };
}

export async function createSession(client, user) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO app_sessions (id, clinic_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), user.clinic_id, user.id, hashToken(token), expiresAt],
  );
  return token;
}

export async function getSessionUser(request) {
  const token = getCookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 256) return null;
  const result = await getPool().query(SESSION_USER_QUERY, [hashToken(token)]);
  return safeUser(result.rows[0]);
}

export async function revokeSession(request) {
  const token = getCookieValue(request, SESSION_COOKIE);
  if (!token) return;
  await getPool().query("DELETE FROM app_sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function clearUserSessions(client, userId) {
  await client.query("DELETE FROM app_sessions WHERE user_id = $1", [userId]);
}
