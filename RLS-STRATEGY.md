# RLS Strategy for the Al-Nather Multi-Clinic SaaS

**Status:** design only. No RLS migration was applied, no Supabase project was accessed, and no production database was used.

## 1. Security objective

PostgreSQL must independently enforce tenant isolation, in addition to the application’s existing `clinic_id` predicates. Every tenant-owned read, insert, update, and delete must be limited to the authenticated clinic. Branch-scoped users must also be limited to their branch where a record is branch-owned. Application code must continue to enforce business permissions; RLS is a second isolation boundary, not a replacement for authorization.

## 2. Database roles and Supabase access

Use separate credentials for separate duties:

- **Runtime role:** a dedicated login role such as `alnather_app`, with only required schema/table/sequence/function privileges. It must be `NOSUPERUSER`, `NOBYPASSRLS`, and must not own tenant tables. Vercel receives only this credential as `DATABASE_URL`.
- **Migration role:** a separate credential used only by controlled migration execution. It owns or can alter schema objects and is never configured in the deployed application.
- Never use Supabase `service_role`, a project owner, a table owner, or any role with `BYPASSRLS` for normal application traffic. `FORCE ROW LEVEL SECURITY` does not constrain superusers or roles with `BYPASSRLS`.
- Revoke direct table access from Supabase `anon` and `authenticated` roles, and disable or avoid the public Data API for these application tables. The application server is the only supported data path.

Before rollout, inspect the actual Supabase role grants rather than assuming that a username or connection string is non-owner.

## 3. Transaction-scoped clinic context

Add a single server-side wrapper, conceptually `withClinic(user, work)`, that:

1. obtains one pooled client;
2. begins a transaction;
3. sets transaction-local context using parameterized `SELECT set_config('app.clinic_id', $1, true)` (and, when required, branch and trusted role context);
4. executes every query for that request using that same client;
5. commits or rolls back, then releases the client.

Do not use session-level `SET`, which can leak scope when pooled connections are reused. Do not interpolate clinic IDs into SQL. The clinic ID must come only from the validated server session, never from request JSON, URL parameters, or a browser-provided header.

RLS policies should fail closed when `app.clinic_id` is unset. A representative clinic predicate is `clinic_id = NULLIF(current_setting('app.clinic_id', true), '')`; apply it to both `USING` and `WITH CHECK`. Tenant predicates must remain in application SQL as defense in depth.

Branch context should likewise be set only from the authenticated server session. Admins may span branches within their clinic; a branch employee must not gain a wider scope by submitting a different `branch_id`. Shared clinic-level records (for example, products with no branch) need an explicit, documented policy rather than an accidental NULL bypass.

## 4. Authentication and onboarding need narrow exceptions

Login and session resolution begin before the application knows a trusted clinic context. Do not solve that by granting the runtime role general cross-tenant reads.

- Resolve a clinic slug through a narrowly scoped, read-only directory function or view that exposes only the minimum public clinic locator fields.
- Once a clinic ID is resolved, enter a transaction with that clinic context before reading the account by normalized username/phone and verifying its password.
- A session cookie lookup starts from a token hash. Use a narrowly scoped `SECURITY DEFINER` lookup that returns only the candidate clinic/session identifiers needed to establish context; then set the GUC and re-read/validate the session and user through ordinary RLS-protected queries. Fix the function owner, `search_path`, execute grants, inputs, and returned columns explicitly. Do not return passwords or broad user records from the helper.
- Rate-limit records must be explicitly classified as global or clinic-scoped and protected accordingly.
- There is currently no public clinic-creation flow. Keep clinic provisioning as a controlled platform operation until a separate tenant-onboarding design exists. Platform administration must not be conflated with a clinic `admin`; every platform operator’s tenant access must be separately authorized and audited.

These exceptions need integration tests before RLS is enforced. The existing authentication code must be refactored to use the new scope-aware access path first.

## 5. Tables, branches, and referential integrity

Inventory every table and classify it as global control-plane data or tenant data. Tenant tables include at least `app_users`, `app_sessions`, `clinic_records`, `branches`, `inventory_batches`, `stock_movements`, `branch_transfers`, `invoice_counters`, `invoice_payments`, and `audit_events`. Add `clinic_id` to any tenant-owned table that lacks it before adding policies.

Where a row contains a branch reference, make the tenant relationship explicit in the schema:

- provide a unique key on `branches (clinic_id, id)`;
- use composite foreign keys such as `(clinic_id, branch_id) REFERENCES branches(clinic_id, id)` for users, sessions where applicable, payments, batches, movements, counters, and audit rows;
- use separate composite constraints for transfer `from_branch_id` and `to_branch_id`;
- preserve business-specific restrictions such as preventing removal of branches with inventory or pending transfers.

Use matching composite references for other tenant-owned relationships where the schema permits them. For polymorphic `clinic_records` references, document the gaps and use an explicit validation/trigger strategy if a safe declarative FK cannot represent the relationship.

## 6. Audit data

`audit_events` must be protected by the same clinic policy, with branch data restricted according to the application’s admin/branch rules. The `audit.view` permission remains server-enforced and clinic-admin-only. Do not expose audit data through Supabase’s public API.

Before/after data can contain medical information. Keep audit export private and no-store, avoid logging credentials or embedded binary data, and preserve the existing admin-only export permission. Establish a retention and encrypted backup policy before production use.

## 7. Required code migration before enabling RLS

The current server has some direct pool queries and many transactions that do not establish a PostgreSQL clinic GUC. Adding policies before converting those paths would break normal behavior, while using an owner/service credential would silently bypass the intended control.

Create an inventory of every `getPool().query`, `withTransaction`, raw client query, authentication query, migration, and background job. Refactor tenant reads and writes so their full query graph shares one transaction client and one trusted clinic context. Explicitly classify unavoidable global lookups and route them through narrow helpers. Keep all clinic filters in SQL even after RLS is present.

## 8. Isolated verification and rollout gates

Do not run these tests against production. Use a disposable local PostgreSQL instance or dedicated isolated test project with the runtime role, not the migration owner, for the assertions.

1. Create clinics A and B, branches A1/A2 and B1, users for each scope, and representative rows in every tenant table.
2. With clinic A context, verify reads expose only A and every insert/update that supplies B’s `clinic_id` fails. Test cross-clinic foreign keys independently.
3. With branch A1 context, verify branch A2 rows are hidden and writes to A2 fail; verify admin A can access A1/A2 but never B.
4. Repeat through every API route, including collections, invoices/payments/returns, stock, transfers, imports, exports, sessions, and audit export.
5. Verify missing GUC returns no rows and rejects writes; verify rollback clears context on connection reuse.
6. Verify login, logout, idle/absolute session expiry, clinic slug collisions, password reset, and controlled first-clinic provisioning under the proposed narrow authentication path.
7. Verify `anon`/`authenticated` cannot read or mutate tenant tables through Supabase Data API, and verify runtime credentials are not owner/BYPASSRLS.
8. Only after all tests pass: apply additive schema changes in a non-production environment, rehearse rollback, then request explicit production-project approval and deploy the runtime credential separately from migration secrets.

## 9. Immediate next implementation slice

The next code-only slice should be a query-path inventory and a tested `withClinic` wrapper on an isolated PostgreSQL database. Do not enable `FORCE ROW LEVEL SECURITY` or change production secrets until all API and authentication paths are converted and the cross-tenant test matrix passes.
