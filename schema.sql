-- ============================================================
-- نظام إدارة عيادات فحص النظر والبصريات — "عيادة العلي"
-- Optometry & Eye Clinic Management System — Schema
-- ============================================================

CREATE TYPE user_role       AS ENUM ('admin','accountant','receptionist','examiner');
CREATE TYPE gender          AS ENUM ('male','female');
CREATE TYPE rx_section      AS ENUM ('distance','near');
CREATE TYPE eye_side        AS ENUM ('OD','OS');
CREATE TYPE pay_method      AS ENUM ('cash','card','installments','transfer');
CREATE TYPE pay_status      AS ENUM ('paid','partial','unpaid');
CREATE TYPE followup_status AS ENUM ('pending','done','overdue');
CREATE TYPE product_cat     AS ENUM ('lenses','frames','medical_glasses','accessories','other');

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    full_name     TEXT        NOT NULL,
    username      TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    role          user_role   NOT NULL DEFAULT 'receptionist',
    avatar_url    TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE examiners (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT    NOT NULL,
    phone      TEXT,
    job_title  TEXT    NOT NULL DEFAULT 'أخصائي بصريات',
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE patients (
    id          BIGSERIAL PRIMARY KEY,
    file_number TEXT    NOT NULL UNIQUE,
    full_name   TEXT    NOT NULL,
    phone1      TEXT,
    phone2      TEXT,
    gender      gender  NOT NULL DEFAULT 'male',
    birth_date  DATE,
    address     TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_patients_name  ON patients (full_name);
CREATE INDEX idx_patients_phone ON patients (phone1);

CREATE TABLE exams (
    id            BIGSERIAL PRIMARY KEY,
    patient_id    BIGINT  NOT NULL REFERENCES patients(id)  ON DELETE CASCADE,
    examiner_id   BIGINT  REFERENCES examiners(id)          ON DELETE SET NULL,
    exam_date     DATE    NOT NULL DEFAULT CURRENT_DATE,
    price         NUMERIC(12,2) NOT NULL DEFAULT 0,
    pd            NUMERIC(5,1),
    va_od         TEXT,
    va_os         TEXT,
    refraction    TEXT,
    lens_type     TEXT,
    review_date   DATE,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_exams_patient ON exams (patient_id, exam_date DESC);

CREATE TABLE prescriptions (
    id       BIGSERIAL PRIMARY KEY,
    exam_id  BIGINT     NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    section  rx_section NOT NULL,
    eye      eye_side   NOT NULL,
    sph      NUMERIC(6,2),
    cyl      NUMERIC(6,2),
    axis     INTEGER CHECK (axis BETWEEN 0 AND 180),
    UNIQUE (exam_id, section, eye)
);

CREATE TABLE products (
    id             BIGSERIAL PRIMARY KEY,
    name           TEXT        NOT NULL,
    barcode        TEXT UNIQUE,
    category       product_cat NOT NULL DEFAULT 'other',
    purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    selling_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity       INTEGER       NOT NULL DEFAULT 0,
    min_stock      INTEGER       NOT NULL DEFAULT 5,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_low ON products (quantity) WHERE quantity <= min_stock;

CREATE TABLE invoices (
    id             BIGSERIAL PRIMARY KEY,
    invoice_no     TEXT        NOT NULL UNIQUE,
    patient_id     BIGINT      REFERENCES patients(id) ON DELETE SET NULL,
    exam_id        BIGINT      REFERENCES exams(id)    ON DELETE SET NULL,
    issue_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
    subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount       NUMERIC(12,2) NOT NULL DEFAULT 0,
    total          NUMERIC(12,2) NOT NULL DEFAULT 0,
    paid           NUMERIC(12,2) NOT NULL DEFAULT 0,
    remaining      NUMERIC(12,2) GENERATED ALWAYS AS (total - paid) STORED,
    payment_method pay_method  NOT NULL DEFAULT 'cash',
    payment_status pay_status  NOT NULL DEFAULT 'unpaid',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoice_items (
    id          BIGSERIAL PRIMARY KEY,
    invoice_id  BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id  BIGINT REFERENCES products(id) ON DELETE SET NULL,
    description TEXT   NOT NULL,
    quantity    INTEGER NOT NULL DEFAULT 1,
    unit_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal    NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE TABLE followups (
    id         BIGSERIAL PRIMARY KEY,
    patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    exam_id    BIGINT REFERENCES exams(id) ON DELETE SET NULL,
    due_date   DATE   NOT NULL,
    due_time   TIME,
    status     followup_status NOT NULL DEFAULT 'pending',
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_followups_due ON followups (due_date, status);

CREATE TABLE whatsapp_templates (
    id   BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    body TEXT NOT NULL
);

CREATE TABLE clinic_settings (
    id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    clinic_name  TEXT NOT NULL DEFAULT 'عيادة العلي',
    phone1       TEXT,
    phone2       TEXT,
    footer_text  TEXT,
    primary_color TEXT NOT NULL DEFAULT '#2c1b3d',
    logo_url     TEXT,
    wa_country_code TEXT NOT NULL DEFAULT '964'
);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_patients_touch BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_users_touch    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
