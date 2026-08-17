-- 004_status_record_photos.sql
-- Photos attached to a captured status_records row (daily or monthly).
-- patient_id is denormalized from status_records for direct lookups; it is
-- NOT a FK to patients (see 003_status_records_external_pat_id.sql — patient_id
-- can store an external mst_customer.pat_id with no local patients row).

CREATE TABLE IF NOT EXISTS status_record_photos (
  id SERIAL PRIMARY KEY,
  status_record_id INT NOT NULL REFERENCES status_records(id) ON DELETE CASCADE,
  patient_id INT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  original_filename VARCHAR(255),
  file_size INT,
  file_data BYTEA NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS status_record_photos_record_idx ON status_record_photos (status_record_id);
CREATE INDEX IF NOT EXISTS status_record_photos_patient_idx ON status_record_photos (patient_id);
