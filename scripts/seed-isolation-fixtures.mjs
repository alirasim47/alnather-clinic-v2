import pg from "pg";
import bcrypt from "bcryptjs";
import { validateAdminPassword } from "./password-policy.mjs";

const databaseUrl = process.env.DATABASE_URL;
const testPassword = process.env.ISOLATION_TEST_PASSWORD || "";
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!databaseUrl || !testPassword) fail("Set DATABASE_URL and ISOLATION_TEST_PASSWORD for the isolated test database only.");
let parsed;
try { parsed = new URL(databaseUrl); } catch { fail("DATABASE_URL is not a valid local PostgreSQL URL."); }
if (!parsed || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
  || parsed.port !== "55432" || parsed.pathname !== "/alnather_isolation_test") {
  fail("Refusing to seed: this script is restricted to 127.0.0.1:55432/alnather_isolation_test.");
}
const passwordError = validateAdminPassword(testPassword);
if (passwordError) fail(`ISOLATION_TEST_PASSWORD does not meet test password policy: ${passwordError}.`);

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1, connectionTimeoutMillis: 3000 });
const client = await pool.connect();
try {
  const target = await client.query(`
    SELECT current_database() AS database_name, current_user AS role_name,
           inet_server_addr()::text AS server_address, inet_server_port() AS server_port
  `);
  const identity = target.rows[0];
  if (identity.database_name !== "alnather_isolation_test" || identity.role_name !== "alnather_test_migrator"
    || !["127.0.0.1", "127.0.0.1/32"].includes(identity.server_address) || Number(identity.server_port) !== 55432) {
    throw new Error("Connection target does not match the isolated test database allowlist.");
  }

  const hash = await bcrypt.hash(testPassword, 12);
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO clinics(id,name,slug) VALUES
      ('test-clinic-a','RLS Test Clinic A','rls-test-a'),
      ('test-clinic-b','RLS Test Clinic B','rls-test-b')
     ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug`,
  );
  await client.query(
    `INSERT INTO branches(id,clinic_id,name,code,active) VALUES
      ('test-branch-a1','test-clinic-a','Test Branch A1','A1',TRUE),
      ('test-branch-a2','test-clinic-a','Test Branch A2','A2',TRUE),
      ('test-branch-b1','test-clinic-b','Test Branch B1','B1',TRUE)
     ON CONFLICT(id) DO UPDATE SET clinic_id=EXCLUDED.clinic_id,name=EXCLUDED.name,code=EXCLUDED.code,active=TRUE`,
  );
  await client.query(
    `INSERT INTO app_users(id,clinic_id,branch_id,name,username,username_normalized,password_hash,role,permissions,active,must_change_password)
     VALUES
      ('test-user-a-admin','test-clinic-a',NULL,'Test Admin A','sharedadmin','sharedadmin',$1,'admin','{}'::jsonb,TRUE,FALSE),
      ('test-user-a1-staff','test-clinic-a','test-branch-a1','Test Staff A1','staffa1','staffa1',$1,'receptionist','{}'::jsonb,TRUE,FALSE),
      ('test-user-a2-staff','test-clinic-a','test-branch-a2','Test Staff A2','staffa2','staffa2',$1,'receptionist','{}'::jsonb,TRUE,FALSE),
      ('test-user-b-admin','test-clinic-b',NULL,'Test Admin B','sharedadmin','sharedadmin',$1,'admin','{}'::jsonb,TRUE,FALSE),
      ('test-user-b1-staff','test-clinic-b','test-branch-b1','Test Staff B1','staffb1','staffb1',$1,'receptionist','{}'::jsonb,TRUE,FALSE)
     ON CONFLICT(id) DO UPDATE SET clinic_id=EXCLUDED.clinic_id,branch_id=EXCLUDED.branch_id,name=EXCLUDED.name,
       username=EXCLUDED.username,username_normalized=EXCLUDED.username_normalized,password_hash=EXCLUDED.password_hash,
       role=EXCLUDED.role,permissions=EXCLUDED.permissions,active=TRUE,must_change_password=FALSE`,
    [hash],
  );
  await client.query("COMMIT");
  console.log("Seeded synthetic fixtures: 2 clinics, 3 branches, 2 clinic admins with a shared login name, and 3 branch staff accounts.");
  console.log("The same temporary test password was applied to all fixture users; its value was not printed.");
} catch (error) {
  try { await client.query("ROLLBACK"); } catch {}
  console.error("Could not seed isolated RLS fixtures:", error?.code || error?.message || "unknown error");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
