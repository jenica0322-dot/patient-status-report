-- Drop FK so status_records.patient_id can store external mst_customer.pat_id
-- without requiring a local patients row.
ALTER TABLE status_records
  DROP CONSTRAINT IF EXISTS status_records_patient_id_fkey;
