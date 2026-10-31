CREATE TABLE IF NOT EXISTS clinics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);
CREATE INDEX IF NOT EXISTS branches_by_clinic ON branches(clinic_id, active, name);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'receptionist',
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, username_normalized)
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_phone_by_clinic
  ON app_users(clinic_id, regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g'))
  WHERE phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS app_users_by_branch ON app_users(clinic_id, branch_id, active);

CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_sessions_by_user ON app_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  bucket_hash CHAR(64) PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clinic_records (
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, collection, record_id)
);
CREATE INDEX IF NOT EXISTS clinic_records_collection ON clinic_records(clinic_id, collection, updated_at DESC);
CREATE INDEX IF NOT EXISTS clinic_records_branch ON clinic_records(clinic_id, collection, branch_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS clinic_products_barcode
  ON clinic_records(clinic_id, lower(data->>'barcode'))
  WHERE collection = 'products' AND coalesce(data->>'barcode', '') <> '' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clinic_invoices_number
  ON clinic_records(clinic_id, lower(data->>'no'))
  WHERE collection = 'invoices' AND coalesce(data->>'no', '') <> '' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  received_qty NUMERIC(12,2) NOT NULL CHECK (received_qty >= 0),
  remaining_qty NUMERIC(12,2) NOT NULL CHECK (remaining_qty >= 0),
  reserved_qty NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_type TEXT NOT NULL DEFAULT 'opening',
  source_id TEXT,
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (remaining_qty <= received_qty),
  CHECK (reserved_qty <= remaining_qty)
);
CREATE INDEX IF NOT EXISTS inventory_batches_fifo ON inventory_batches(clinic_id, branch_id, product_id, received_at, id)
  WHERE remaining_qty > 0;

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  batch_id TEXT REFERENCES inventory_batches(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening','purchase','sale','return','adjustment','transfer_out','transfer_in')),
  quantity_delta NUMERIC(12,2) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id TEXT,
  notes TEXT,
  actor_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_history ON stock_movements(clinic_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_product ON stock_movements(clinic_id, product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS branch_transfers (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  from_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  to_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  resolved_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS branch_transfers_by_clinic ON branch_transfers(clinic_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_counters (
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  year INTEGER NOT NULL,
  current_value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (clinic_id, branch_id, year)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  collection TEXT,
  record_id TEXT,
  branch_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_by_clinic ON audit_events(clinic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','card','transfer','installments')),
  reference TEXT,
  notes TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS invoice_payments_by_invoice
  ON invoice_payments(clinic_id, invoice_id, paid_at ASC, id);
CREATE INDEX IF NOT EXISTS invoice_payments_by_branch
  ON invoice_payments(clinic_id, branch_id, paid_at DESC);
