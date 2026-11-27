-- 011_category_nashi_options.sql
-- 「問題なし」 / 「なし」 rework:
--   * 問題なし on 食べ残し = everything is fine: Status Input ticks each later
--     category's own 「なし」 and saves. So every issue category needs a
--     「なし」 option — added here to 状況 and 体調 (特記 already has one;
--     食べ残し's 「なし」 is 完食).
--   * Each 「なし」 column sits at the end of its category in the 報告書
--     (columns are ordered by order_index).
--   * 「問題なし」 checkbox columns left behind by earlier マスター saves —
--     not used by any category and holding no saved value — are removed.
-- Saved records are not touched.

-- 1. Leftover 「問題なし」 columns (not the real 問題なし column, mondai_nashi).
DELETE FROM status_fields f
WHERE f.screen_key = 'daily_status'
  AND f.field_label = '問題なし'
  AND f.field_key <> 'mondai_nashi'
  AND f.field_type = 'checkbox'
  AND NOT EXISTS (
    SELECT 1 FROM status_fields t, jsonb_array_elements(t.phrases) o
    WHERE t.screen_key = 'daily_target' AND o->>'key' = f.field_key
  )
  AND NOT EXISTS (SELECT 1 FROM status_records r WHERE r.values ? f.field_key);

-- 2. 「なし」 for 状況 and 体調 (only if the category has none yet).
INSERT INTO status_fields (screen_key, field_key, field_label, field_type, phrases, order_index)
SELECT 'daily_status', v.col, 'なし', 'checkbox', '[]'::jsonb,
       (SELECT COALESCE(MAX(order_index), 0) + 1 FROM status_fields WHERE screen_key = 'daily_status')
FROM (VALUES ('__jokyo', 'jokyo_nashi'), ('__taicho', 'taicho_nashi')) AS v(cat, col)
WHERE EXISTS (
    SELECT 1 FROM status_fields t
    WHERE t.screen_key = 'daily_target' AND t.field_key = v.cat
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.phrases) o WHERE o->>'label' = 'なし')
  )
  AND NOT EXISTS (SELECT 1 FROM status_fields WHERE screen_key = 'daily_status' AND field_key = v.col);

UPDATE status_fields t
SET phrases = t.phrases || jsonb_build_array(jsonb_build_object('label', 'なし', 'key', v.col))
FROM (VALUES ('__jokyo', 'jokyo_nashi'), ('__taicho', 'taicho_nashi')) AS v(cat, col)
WHERE t.screen_key = 'daily_target' AND t.field_key = v.cat
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.phrases) o WHERE o->>'label' = 'なし');

-- 3. Each category's 「なし」 column right after its other columns.
DO $$
DECLARE
  cat RECORD;
  none_key TEXT;
  last_ord INT;
BEGIN
  FOR cat IN
    SELECT field_key, phrases FROM status_fields
    WHERE screen_key = 'daily_target' AND field_key <> '__tabenokoshi'
    ORDER BY order_index, field_key
  LOOP
    none_key := NULL;
    SELECT o->>'key' INTO none_key
    FROM jsonb_array_elements(cat.phrases) o
    WHERE o->>'label' = 'なし' AND COALESCE(o->>'key', '') <> ''
    LIMIT 1;
    CONTINUE WHEN none_key IS NULL;

    SELECT MAX(f.order_index) INTO last_ord
    FROM status_fields f, jsonb_array_elements(cat.phrases) o
    WHERE f.screen_key = 'daily_status' AND f.field_key = o->>'key' AND o->>'label' <> 'なし';
    CONTINUE WHEN last_ord IS NULL;

    UPDATE status_fields SET order_index = order_index + 1
    WHERE screen_key = 'daily_status' AND order_index > last_ord AND field_key <> none_key;
    UPDATE status_fields SET order_index = last_ord + 1
    WHERE screen_key = 'daily_status' AND field_key = none_key;
  END LOOP;
END $$;
