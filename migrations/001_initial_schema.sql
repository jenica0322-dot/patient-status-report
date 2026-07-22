-- 001_initial_schema.sql
-- Core tables: staff login, patients, master fields, captured records.

CREATE TABLE IF NOT EXISTS mst_employee (
  employee_id VARCHAR(50) PRIMARY KEY,
  employee_password VARCHAR(255) NOT NULL,
  employee_name VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Master data: fields shown in the capture UI.
-- screen_key = 'daily_status'   -> captured per patient per record_date
-- screen_key = 'monthly_report' -> captured per patient per record_year_month
CREATE TABLE IF NOT EXISTS status_fields (
  screen_key VARCHAR(50) NOT NULL,
  field_key VARCHAR(100) NOT NULL,
  field_label VARCHAR(200) NOT NULL,
  field_type VARCHAR(20) NOT NULL DEFAULT 'text', -- text | checkbox | preset
  phrases JSONB DEFAULT '[]',
  order_index INT DEFAULT 0,
  PRIMARY KEY (screen_key, field_key)
);

-- Captured values, one row per save action.
CREATE TABLE IF NOT EXISTS status_records (
  id SERIAL PRIMARY KEY,
  screen_key VARCHAR(50) NOT NULL,
  patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  record_date DATE,
  record_year_month VARCHAR(7), -- 'YYYY-MM'
  values JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CHECK (record_date IS NOT NULL OR record_year_month IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS status_records_patient_idx ON status_records (patient_id);

-- One row per patient per day for daily_status, one per patient per month for monthly_report.
CREATE UNIQUE INDEX IF NOT EXISTS status_records_daily_uq
  ON status_records (screen_key, patient_id, record_date)
  WHERE record_date IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS status_records_monthly_uq
  ON status_records (screen_key, patient_id, record_year_month)
  WHERE record_year_month IS NOT NULL;
