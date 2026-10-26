-- 005_status_field_mondai_nashi.sql
-- 問題なし (no issues) — a 4th 食べ残し choice on Status Input, shown in the
-- report's daily grid right after 残し (in the 食事 group, before 食べ残しコメント).
-- Every daily field after 残し moves down one slot to make room; positions are
-- read from the current 残し row so any reordering done in マスター is kept.

UPDATE status_fields
SET order_index = order_index + 1
WHERE screen_key = 'daily_status'
  AND order_index > (SELECT order_index FROM status_fields WHERE screen_key = 'daily_status' AND field_key = 'nokoshi')
  AND NOT EXISTS (SELECT 1 FROM status_fields WHERE screen_key = 'daily_status' AND field_key = 'mondai_nashi');

INSERT INTO status_fields (screen_key, field_key, field_label, field_type, phrases, order_index)
SELECT 'daily_status', 'mondai_nashi', '問題なし', 'checkbox', '[]', order_index + 1
FROM status_fields
WHERE screen_key = 'daily_status' AND field_key = 'nokoshi'
ON CONFLICT (screen_key, field_key) DO NOTHING;
