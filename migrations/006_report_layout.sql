-- 006_report_layout.sql
-- マスター設定: the 報告書's configurable layout (報告書コメント欄 blocks and the
-- footer row), stored as one JSON document per layout. No row = the default
-- layout derived from status_fields (the original fixed sheet).

CREATE TABLE IF NOT EXISTS report_layout (
  layout_key VARCHAR(50) PRIMARY KEY,
  config JSONB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
