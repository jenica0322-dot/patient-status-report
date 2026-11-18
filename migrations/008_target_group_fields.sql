-- 008_target_group_fields.sql
-- 日次記録's three Status Input categories — うけとり / 食べ残し / 体調 —
-- become editable in マスター. Stored under their own screen_key (daily_target)
-- so the 報告書, which reads only daily_status rows, doesn't turn them into
-- columns.
--   field_label: the label shown as the heading on Status Input.
--   phrases (食べ残し / 体調): the options — label, the daily_status column it
--     saves into, and (体調他) follow-up choices saved as text into that column.
--   うけとり's options stay in its daily_status row; this row holds only its
--     label, since that row's field_label is the 報告書 column header.
-- Existing rows are left alone so edits made in マスター are kept.

INSERT INTO status_fields (screen_key, field_key, field_label, field_type, phrases, order_index) VALUES
('daily_target', 'uketori', 'うけとり状況を選択', 'heading', '[]', 0),
('daily_target', '__tabenokoshi', '食べ残し状況を選択', 'group',
  '[{"label":"なし","key":"kanshoku"},{"label":"半分","key":"hanbun"},{"label":"あり","key":"nokoshi"},{"label":"問題なし","key":"mondai_nashi"}]', 1),
('daily_target', '__taicho', '体調を選択（複数選択可）', 'group',
  '[{"label":"食欲低下","key":"shokuyoku_teika"},{"label":"顔色・元気","key":"kaoiro_genki"},{"label":"ふらつき","key":"furatsuki"},{"label":"体調他","key":"taicho_ta","sub":["風邪"]}]', 2)
ON CONFLICT (screen_key, field_key) DO NOTHING;
