// server/lib/reportLayout.js
// Layout of the 報告書's configurable parts — the numbered 報告書コメント欄
// blocks (①総合評価 …) and the footer row (報告日 / 確認者 / 家族・関係機関共有) —
// as set in マスター設定. The on-screen report, the Excel export and the PDF
// export all build those parts from this one layout.
//
// Stored as one JSON document in report_layout (key 'monthly'). Until an admin
// saves one, the layout is derived from status_fields, which reproduces the
// original fixed sheet exactly.
//
// Layout shape:
// {
//   version: 1,
//   commentBlocks: [{ fieldKey, title, options: string[], visible,
//                     freeText: { enabled, fieldKey, label } }],
//   footer: { perRow, items: [{ fieldKey, label, type: "date"|"text"|"checklist",
//                               options: string[], visible }] }
// }
// Values are saved in the month's monthly_report record under each fieldKey,
// so renaming an item never loses what was entered.

const { CIRCLED_NUMBERS } = require("./reportFormat");

const LAYOUT_KEY = "monthly";
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,59}$/;
const FOOTER_TYPES = ["date", "text", "checklist"];
const MAX_BLOCKS = 20;
const MAX_FOOTER_ITEMS = 12;
const MAX_OPTIONS = 30;
const MAX_PER_ROW = 4;

// Monthly fields with a fixed place elsewhere on the sheet (header block, 総評)
// — not available to the configurable parts.
const RESERVED_KEYS = new Set([
  "hasso_tanto",
  "shokuji_naiyo",
  "riyo_kaisu",
  "renraku_hoho",
  "hokoku_saki",
  "senpo_tantosha",
  "kinyusha",
  "sohyo",
]);

class LayoutError extends Error {}

// ---- Default (the original fixed sheet) ----

// Pairs each preset field with the free-text field that follows it (…_hitokoto /
// …_naiyo) between 総合評価 and 総評 — how the blocks were laid out before
// マスター設定 existed.
function defaultCommentBlocks(monthlyFields) {
  const ordered = monthlyFields.slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  const bodyStart = ordered.findIndex((f) => f.field_key === "sogo_hyoka");
  const sohyoIdx = ordered.findIndex((f) => f.field_key === "sohyo");
  const body = bodyStart >= 0 ? ordered.slice(bodyStart, sohyoIdx >= 0 ? sohyoIdx : undefined) : [];
  const footerKeys = new Set(["hokokubi", "kakuninsha", "kyoyu_status"]);

  const blocks = [];
  let i = 0;
  while (i < body.length) {
    const field = body[i];
    const next = body[i + 1];
    if (footerKeys.has(field.field_key)) {
      i += 1;
      continue;
    }
    if (next && next.field_key.startsWith(`${field.field_key}_`) && next.field_type === "text") {
      const label = next.field_label.includes("・") ? next.field_label.split("・").pop() : next.field_label;
      blocks.push({
        fieldKey: field.field_key,
        title: field.field_label,
        options: field.phrases || [],
        visible: true,
        freeText: { enabled: true, fieldKey: next.field_key, label },
      });
      i += 2;
    } else {
      blocks.push({
        fieldKey: field.field_key,
        title: field.field_label,
        options: field.phrases || [],
        visible: true,
        freeText: { enabled: false, fieldKey: `${field.field_key}_hitokoto`, label: "一言" },
      });
      i += 1;
    }
  }
  return blocks;
}

function defaultLayout(monthlyFields) {
  const byKey = Object.fromEntries(monthlyFields.map((f) => [f.field_key, f]));
  return {
    version: 1,
    commentBlocks: defaultCommentBlocks(monthlyFields),
    footer: {
      perRow: 3,
      items: [
        { fieldKey: "hokokubi", label: byKey.hokokubi?.field_label || "報告日", type: "date", options: [], visible: true },
        { fieldKey: "kakuninsha", label: byKey.kakuninsha?.field_label || "確認者", type: "text", options: [], visible: true },
        {
          fieldKey: "kyoyu_status",
          label: byKey.kyoyu_status?.field_label || "家族・関係機関共有",
          type: "checklist",
          options: byKey.kyoyu_status?.phrases?.length ? byKey.kyoyu_status.phrases : ["済", "未", "不要"],
          visible: true,
        },
      ],
    },
  };
}

// ---- Validation ----

function cleanText(value, what, { max, required }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new LayoutError(`${what}を入力してください`);
  if (text.length > max) throw new LayoutError(`${what}は${max}文字以内にしてください`);
  return text;
}

function cleanOptions(value, what) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new LayoutError(`${what}の選択肢が不正です`);
  const out = [];
  for (const raw of value) {
    const text = cleanText(raw, `${what}の選択肢`, { max: 100, required: false });
    if (!text) continue;
    if (out.includes(text)) throw new LayoutError(`${what}の選択肢「${text}」が重複しています`);
    out.push(text);
  }
  if (out.length > MAX_OPTIONS) throw new LayoutError(`${what}の選択肢は${MAX_OPTIONS}個までです`);
  return out;
}

function cleanKey(value, what) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!FIELD_KEY_RE.test(key)) throw new LayoutError(`${what}のキーが不正です（半角英小文字・数字・_）`);
  if (RESERVED_KEYS.has(key)) throw new LayoutError(`${what}のキー「${key}」は他の欄で使われています`);
  return key;
}

// Checks an incoming layout and returns a clean copy. Throws LayoutError with a
// message fit to show the admin.
function normalizeLayout(input) {
  if (!input || typeof input !== "object") throw new LayoutError("レイアウトが不正です");
  const blocksIn = Array.isArray(input.commentBlocks) ? input.commentBlocks : [];
  const footerIn = input.footer && typeof input.footer === "object" ? input.footer : {};
  const itemsIn = Array.isArray(footerIn.items) ? footerIn.items : [];
  if (blocksIn.length > MAX_BLOCKS) throw new LayoutError(`コメント欄の項目は${MAX_BLOCKS}個までです`);
  if (itemsIn.length > MAX_FOOTER_ITEMS) throw new LayoutError(`フッターの項目は${MAX_FOOTER_ITEMS}個までです`);

  const usedKeys = new Set();
  const claim = (key, what) => {
    if (usedKeys.has(key)) throw new LayoutError(`${what}のキー「${key}」が重複しています`);
    usedKeys.add(key);
  };

  const commentBlocks = blocksIn.map((b, i) => {
    const what = `コメント欄 ${i + 1}番目`;
    const fieldKey = cleanKey(b?.fieldKey, what);
    claim(fieldKey, what);
    const ft = b?.freeText && typeof b.freeText === "object" ? b.freeText : {};
    const ftEnabled = !!ft.enabled;
    const ftKey = cleanKey(ft.fieldKey || `${fieldKey}_hitokoto`, `${what}の自由記入欄`);
    if (ftEnabled) claim(ftKey, `${what}の自由記入欄`);
    return {
      fieldKey,
      title: cleanText(b?.title, `${what}の見出し`, { max: 100, required: true }),
      options: cleanOptions(b?.options, what),
      visible: b?.visible !== false,
      freeText: {
        enabled: ftEnabled,
        fieldKey: ftKey,
        label: cleanText(ft.label, `${what}の自由記入欄の名前`, { max: 20, required: ftEnabled }) || "一言",
      },
    };
  });

  const items = itemsIn.map((it, i) => {
    const what = `フッター ${i + 1}番目`;
    const fieldKey = cleanKey(it?.fieldKey, what);
    claim(fieldKey, what);
    const type = FOOTER_TYPES.includes(it?.type) ? it.type : "text";
    const options = type === "checklist" ? cleanOptions(it?.options, what) : [];
    if (type === "checklist" && options.length === 0) throw new LayoutError(`${what}（チェック）に選択肢を1つ以上追加してください`);
    return {
      fieldKey,
      label: cleanText(it?.label, `${what}の項目名`, { max: 50, required: true }),
      type,
      options,
      visible: it?.visible !== false,
    };
  });

  const perRow = Math.min(MAX_PER_ROW, Math.max(1, Math.round(Number(footerIn.perRow) || 3)));
  return { version: 1, commentBlocks, footer: { perRow, items } };
}

// ---- Load / save ----

function parsePhrases(p) {
  try {
    return typeof p === "string" ? JSON.parse(p || "[]") : Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

async function loadMonthlyFields(db) {
  const { rows } = await db.query(
    `SELECT field_key, field_label, field_type, phrases, order_index FROM status_fields
     WHERE screen_key='monthly_report' ORDER BY order_index, field_key`
  );
  return rows.map((r) => ({ ...r, phrases: parsePhrases(r.phrases) }));
}

// The saved layout, or the default when none is saved (or the report_layout
// table doesn't exist yet because migration 006 hasn't been run).
async function loadReportLayout(db, monthlyFields) {
  try {
    const { rows } = await db.query(`SELECT config FROM report_layout WHERE layout_key=$1`, [LAYOUT_KEY]);
    if (rows[0]?.config) {
      try {
        return { layout: normalizeLayout(rows[0].config), isDefault: false };
      } catch (e) {
        console.error("stored report layout is invalid, using default:", e.message);
      }
    }
  } catch (e) {
    if (e.code !== "42P01") throw e; // 42P01 = table missing
  }
  const fields = monthlyFields || (await loadMonthlyFields(db));
  return { layout: defaultLayout(fields), isDefault: true };
}

// Saves the layout and mirrors its items into status_fields (label / type /
// options), so the existing マスター page and the monthly Status Input screen
// see the same fields. Existing rows keep their order_index; new ones go last.
async function saveReportLayout(pool, layout) {
  await pool.tx(async (conn) => {
    await conn.query(
      `INSERT INTO report_layout (layout_key, config, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (layout_key) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
      [LAYOUT_KEY, JSON.stringify(layout)]
    );
    const rows = [];
    layout.commentBlocks.forEach((b) => {
      rows.push([b.fieldKey, b.title, "preset", b.options]);
      if (b.freeText.enabled) rows.push([b.freeText.fieldKey, `${b.title}・${b.freeText.label}`, "text", []]);
    });
    layout.footer.items.forEach((it) => {
      rows.push([it.fieldKey, it.label, it.type === "checklist" ? "preset" : "text", it.options]);
    });
    for (let i = 0; i < rows.length; i++) {
      const [key, label, type, phrases] = rows[i];
      await conn.query(
        `INSERT INTO status_fields (screen_key, field_key, field_label, field_type, phrases, order_index)
         VALUES ('monthly_report', $1, $2, $3, $4,
                 (SELECT COALESCE(MAX(order_index), 0) + 1 FROM status_fields WHERE screen_key='monthly_report'))
         ON CONFLICT (screen_key, field_key) DO UPDATE SET
           field_label = EXCLUDED.field_label,
           field_type = EXCLUDED.field_type,
           phrases = EXCLUDED.phrases`,
        [key, label, type, JSON.stringify(phrases)]
      );
    }
  });
}

async function resetReportLayout(pool) {
  try {
    await pool.query(`DELETE FROM report_layout WHERE layout_key=$1`, [LAYOUT_KEY]);
  } catch (e) {
    if (e.code !== "42P01") throw e;
  }
}

// ---- Shared geometry (mirrored in app/lib/reportLayout.ts) ----

// Visible comment blocks, numbered ①②… in display order.
function visibleCommentBlocks(layout) {
  return (layout?.commentBlocks || [])
    .filter((b) => b.visible)
    .map((b, i) => ({ ...b, number: i + 1, numeral: CIRCLED_NUMBERS[i] || `${i + 1}.` }));
}

// How many 月次報告 rows each comment block covers next to the tally rows.
// Up to half as many blocks as rows: 2 rows each, the last taking what's left.
// More than that: 1 row each, the first ones taking the spare rows. More
// blocks than tally rows: 1 row each, the extra rows have empty tally cells.
function planCommentRows(tallyRowCount, blockCount) {
  if (blockCount === 0) return { spans: [], totalRows: tallyRowCount };
  if (blockCount > tallyRowCount) return { spans: new Array(blockCount).fill(1), totalRows: blockCount };
  if (blockCount * 2 <= tallyRowCount) {
    const spans = new Array(blockCount).fill(2);
    spans[blockCount - 1] = tallyRowCount - 2 * (blockCount - 1);
    return { spans, totalRows: tallyRowCount };
  }
  const extra = tallyRowCount - blockCount;
  return { spans: Array.from({ length: blockCount }, (_, i) => (i < extra ? 2 : 1)), totalRows: tallyRowCount };
}

// Visible footer items in rows of `perRow`, each with its label / value column
// spans across `totalCols`.
function planFooterRows(layout, totalCols) {
  const items = (layout?.footer?.items || []).filter((it) => it.visible);
  const perRow = Math.max(1, layout?.footer?.perRow || 3);
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    const rowItems = items.slice(i, i + perRow);
    const labelSpans = rowItems.map((it) => (String(it.label).length > 6 ? 3 : 2));
    const valueCols = Math.max(rowItems.length, totalCols - labelSpans.reduce((a, b) => a + b, 0));
    const base = Math.floor(valueCols / rowItems.length);
    rows.push(
      rowItems.map((item, j) => ({
        item,
        labelSpan: labelSpans[j],
        valueSpan: j === rowItems.length - 1 ? valueCols - base * (rowItems.length - 1) : base,
      }))
    );
  }
  return rows;
}

module.exports = {
  LayoutError,
  defaultLayout,
  normalizeLayout,
  loadMonthlyFields,
  loadReportLayout,
  saveReportLayout,
  resetReportLayout,
  visibleCommentBlocks,
  planCommentRows,
  planFooterRows,
};
