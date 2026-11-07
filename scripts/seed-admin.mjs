import { randomUUID } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";
import { validateAdminPassword } from "./password-policy.mjs";

const clinicName = String(process.env.CLINIC_NAME || "").trim();
const clinicSlug = String(process.env.CLINIC_SLUG || "").trim().toLowerCase();
const adminName = String(process.env.ADMIN_NAME || "").trim();
const username = String(process.env.ADMIN_USERNAME || "").trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || "");

if (!process.env.DATABASE_URL || !clinicName || !clinicSlug || !adminName || !username) {
  console.error("Set DATABASE_URL, CLINIC_NAME, CLINIC_SLUG, ADMIN_NAME and ADMIN_USERNAME.");
  process.exit(1);
}
const passwordError = validateAdminPassword(password);
if (passwordError) {
  console.error(`Invalid ADMIN_PASSWORD: ${passwordError}.`);
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(clinicSlug)) {
  console.error("CLINIC_SLUG must be 3–50 lowercase letters, numbers, or hyphens, and start/end with a letter or number.");
  process.exit(1);
}

const { Pool } = pg;
const sslEnabled = process.env.DATABASE_SSL === "true"
  || (process.env.DATABASE_SSL !== "false" && process.env.NODE_ENV === "production");
const ssl = sslEnabled
  ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
  : undefined;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const exists = await client.query("SELECT 1 FROM clinics WHERE slug = $1", [clinicSlug]);
  if (exists.rowCount) throw new Error("This clinic slug is already initialized; the setup command will not overwrite it.");

  const clinicId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const hash = await bcrypt.hash(password, 12);
  await client.query("INSERT INTO clinics(id, name, slug) VALUES ($1, $2, $3)", [clinicId, clinicName, clinicSlug]);
  await client.query(
    "INSERT INTO branches(id, clinic_id, name, code) VALUES ($1, $2, $3, $4)",
    [branchId, clinicId, "الفرع الرئيسي", "MAIN"],
  );
  await client.query(
    `INSERT INTO app_users(id, clinic_id, branch_id, name, username, username_normalized, password_hash, role, permissions, must_change_password)
     VALUES ($1, $2, NULL, $3, $4, $4, $5, 'admin', '{}'::jsonb, FALSE)`,
    [userId, clinicId, adminName, username, hash],
  );
  await client.query("COMMIT");
  console.log(`Clinic and administrator created. Clinic slug: ${clinicSlug}; username: ${username}. Keep the password private.`);
} catch (error) {
  try { await client.query("ROLLBACK"); } catch {}
  console.error("Initial setup failed:", error?.code || error?.message || "unknown error");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
