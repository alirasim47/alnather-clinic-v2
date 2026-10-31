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
