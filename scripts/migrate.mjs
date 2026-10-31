import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");
  process.exit(1);
}

const { Pool } = pg;
const sslEnabled = process.env.DATABASE_SSL === "true"
  || (process.env.DATABASE_SSL !== "false" && process.env.NODE_ENV === "production");
const ssl = sslEnabled
  ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
  : undefined;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 1,
  connectionTimeoutMillis: 5_000,
});
const client = await pool.connect();

try {
  const migrationFiles = ["0001_platform.sql", "0002_invoice_payments.sql"];
  for (const version of migrationFiles) {
    const sql = await readFile(resolve(process.cwd(), "migrations", version), "utf8");
    await client.query("BEGIN");
    try {
      // Transaction-scoped advisory locks are compatible with Supavisor transaction pooling.
      await client.query("SELECT pg_advisory_xact_lock(642910, 1)");
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

      const exists = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if (!exists.rowCount) {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [version]);
        console.log(`Applied database migration ${version}`);
      }
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    }
  }
} catch (error) {
  console.error("Database migration failed:", error?.code || error?.message || "unknown error");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
