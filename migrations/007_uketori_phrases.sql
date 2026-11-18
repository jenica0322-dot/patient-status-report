-- 007_uketori_phrases.sql
-- うけとり choices on Status Input now come from this master row instead of
-- being hardcoded. Keep only 玄関 / 家族 / 不在 (drops 受取 / 玄関置き /
-- 家族対応 / 中止). Edit them later from マスター → 日次記録 → 受取.

UPDATE status_fields
SET phrases = '["玄関","家族","不在"]'
WHERE screen_key = 'daily_status'
  AND field_key = 'uketori';
