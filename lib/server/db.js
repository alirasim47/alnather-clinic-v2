import "server-only";
import { Pool } from "pg";

const globalForPostgres = globalThis;

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Configure PostgreSQL before starting the application.");
  }

  if (!globalForPostgres.__alnatherPostgresPool) {
    const sslEnabled = process.env.DATABASE_SSL === "true"
      || (process.env.DATABASE_SSL !== "false" && process.env.NODE_ENV === "production");
    const ssl = sslEnabled
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
      : undefined;
    globalForPostgres.__alnatherPostgresPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: Number(process.env.DATABASE_POOL_MAX || (process.env.NODE_ENV === "production" ? 5 : 10)),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: process.env.NODE_ENV !== "production",
    });
    globalForPostgres.__alnatherPostgresPool.on("error", (error) => {
      console.error("PostgreSQL idle client error", error?.code || "unknown");
    });
  }

  return globalForPostgres.__alnatherPostgresPool;
}

export async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
