-- 002_seed_status_fields.sql
-- Master fields derived from 状況記録表兼報告書 (1).xlsx

-- ===== daily_status: captured per patient per day =====
INSERT INTO status_fields (screen_key, field_key, field_label, field_type, phrases, order_index) VALUES
('daily_status', 'youbi',        '曜',        'preset',  '["月","火","水","木","金","土","日"]', 1),
('daily_status', 'uketori',      '受取',      'preset',  '["受取","玄関置き","不在","家族対応","中止"]', 2),
('daily_status', 'kanshoku',     '完食',      'checkbox','[]', 3),
('daily_status', 'hanbun',       '半分',      'checkbox','[]', 4),
('daily_status', 'nokoshi',      '残し',      'checkbox','[]', 5),
('daily_status', 'shokuyoku_teika','食欲低下', 'checkbox','[]', 6),
('daily_status', 'kaoiro_genki', '顔色/元気', 'checkbox','[]', 7),
('daily_status', 'furatsuki',    'ふらつき',  'checkbox','[]', 8),
('daily_status', 'taicho_ta',    '体調他',    'text',    '[]', 9),
('daily_status', 'koekake',      '声かけ',    'checkbox','[]', 10),
('daily_status', 'shinbun_yubin','新聞/郵便', 'checkbox','[]', 11),
('daily_status', 'genkan_anzen', '玄関安全',  'checkbox','[]', 12),
('daily_status', 'shien_ta',     '支援他',    'text',    '[]', 13),
('daily_status', 'ihen_fuzai',   '異変/不在', 'checkbox','[]', 14),
('daily_status', 'renraku_you',  '連絡要',    'checkbox','[]', 15),
('daily_status', 'memo',         'メモ',      'text',    '[]', 16)
ON CONFLICT (screen_key, field_key) DO UPDATE SET
  field_label = EXCLUDED.field_label,
  field_type = EXCLUDED.field_type,
  phrases = EXCLUDED.phrases,
  order_index = EXCLUDED.order_index;

-- ===== monthly_report: captured per patient per year-month =====
INSERT INTO status_fields (screen_key, field_key, field_label, field_type, phrases, order_index) VALUES
('monthly_report', 'hasso_tanto',      '配送担当',                 'preset', '["コントロール","はなやか"]', 1),
('monthly_report', 'shokuji_naiyo',    '食事内容',                 'preset', '["普通","カロリー","塩分","たんぱく+塩分","脂質"]', 2),
('monthly_report', 'riyo_kaisu',       '利用回数',                 'text',   '[]', 3),
('monthly_report', 'renraku_hoho',     '連絡方法',                 'preset', '["電話","LINE","FAX"]', 4),
('monthly_report', 'hokoku_saki',      '報告先',                   'text',   '[]', 5),
('monthly_report', 'senpo_tantosha',   '先方担当者',               'text',   '[]', 6),
('monthly_report', 'kinyusha',         '記入者',                   'text',   '[]', 7),
('monthly_report', 'sogo_hyoka',       '総合評価',                 'preset', '["良好","変化あり","様子見","家族共有","関係機関共有","早急に相談"]', 8),
('monthly_report', 'shokuji_jokyo',    '食事状況',                 'preset', '["よく食べています","半分程度の日あり","残しが増えました","味/量/食種の相談が必要"]', 9),
('monthly_report', 'shokuji_jokyo_hitokoto', '食事状況・一言',     'text',   '[]', 10),
('monthly_report', 'taicho_men',       '体調面',                   'preset', '["変化なし","食欲低下あり","元気がない日あり","ふらつきあり","その他気になる様子あり"]', 11),
('monthly_report', 'taicho_men_hitokoto', '体調面・一言',          'text',   '[]', 12),
('monthly_report', 'nichijo_support',  '実施した日常サポート',     'preset', '["声かけ","新聞/郵便確認","玄関安全確認","雪/ゴミ/電球等","その他"]', 13),
('monthly_report', 'nichijo_support_hitokoto', '日常サポート・一言','text',  '[]', 14),
('monthly_report', 'kyoyu_jiko',       '家族・関係機関への共有事項','preset', '["共有不要","家族へ共有","事務所へ共有","関係機関へ共有","要相談"]', 15),
('monthly_report', 'kyoyu_jiko_naiyo', '共有事項・内容',           'text',   '[]', 16),
('monthly_report', 'taio_hoshin',      '次月の対応方針',           'preset', '["現状継続","食事量を確認","体調を注意して見る","支援内容を継続","食種/回数を相談"]', 17),
('monthly_report', 'taio_hoshin_naiyo','対応方針・方針',           'text',   '[]', 18),
('monthly_report', 'sohyo',            '総評',                     'text',   '[]', 19),
('monthly_report', 'hokokubi',         '報告日',                   'text',   '[]', 20),
('monthly_report', 'kakuninsha',       '確認者',                   'text',   '[]', 21),
('monthly_report', 'kyoyu_status',     '家族・関係機関共有',       'preset', '["済","未","不要"]', 22)
ON CONFLICT (screen_key, field_key) DO UPDATE SET
  field_label = EXCLUDED.field_label,
  field_type = EXCLUDED.field_type,
  phrases = EXCLUDED.phrases,
  order_index = EXCLUDED.order_index;
