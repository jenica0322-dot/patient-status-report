-- 010_status_fields_config.sql
-- Per-category settings for 日次記録's Status Input categories, edited in
-- マスター (daily_target rows): 報告書の表示 (text / checkbox), 単一/複数選択,
-- the text column, コメント入力 on/off, where its comment is stored.
-- Additive: existing rows get '{}' and keep working from their field_type.

ALTER TABLE status_fields ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
