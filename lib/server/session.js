import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "./db";

export const SESSION_COOKIE = "clinic_session";
export const SESSION_HOURS = 12;

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
  const secure = process.env.COOKIE_SECURE === "true"
    || (process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production");
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
  const result = await getPool().query(
    `SELECT u.id, u.clinic_id, u.branch_id, u.name, u.username, u.phone, u.role,
            u.permissions, u.active, u.must_change_password,
            c.name AS clinic_name, c.slug AS clinic_slug,
            b.name AS branch_name
       FROM app_sessions s
       JOIN app_users u ON u.id = s.user_id AND u.clinic_id = s.clinic_id
       JOIN clinics c ON c.id = s.clinic_id
       LEFT JOIN branches b ON b.id = u.branch_id AND b.clinic_id = u.clinic_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = TRUE
      LIMIT 1`,
    [hashToken(token)],
  );
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
