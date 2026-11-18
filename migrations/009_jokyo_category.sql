-- 009_jokyo_category.sql
-- 状況 (状況を選択): a 日次記録 category on Status Input, single choice (単一選択),
-- whose items tick existing 報告書 columns: 声かけ / 新聞/郵便 / 玄関安全 /
-- 支援他. Same storage as 食べ残し / 体調 (daily_target row, each option with
-- the daily_status column it saves into). Left alone if it already exists so
-- edits made in マスター are kept.

INSERT INTO status_fields (screen_key, field_key, field_label, field_type, phrases, order_index) VALUES
('daily_target', '__jokyo', '状況を選択', 'group_single',
  '[{"label":"声かけ","key":"koekake"},{"label":"新聞/郵便","key":"shinbun_yubin"},{"label":"玄関安全","key":"genkan_anzen"},{"label":"支援他","key":"shien_ta"}]', 3)
ON CONFLICT (screen_key, field_key) DO NOTHING;
