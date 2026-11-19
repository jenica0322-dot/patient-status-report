// server/lib/reportPlan.js
// The 報告書's daily grid columns and monthly tallies, built from マスター's
// 日次記録 categories — so the report follows whatever is configured there
// (表示順, テキスト/チェック, columns, コメント入力) without code changes.
// Used by the report API (on-screen 報告書), the Excel and the PDF export.
//
// Category reading mirrors app/lib/targetFields.ts (allCategoryConfigs) —
// keep the two in step.

const { COLORS, FIELD_GROUP, GROUP_COLOR, TALLY_GROUPS, PATIENT_SELECT_FIELD_LABEL, isChecked } = require("./reportFormat");

const TARGET_SCREEN_KEY = "daily_target";
const HEADING_TYPES = new Set(["heading", "heading_multi"]);

// Built-in categories' starting settings (until saved in マスター).
const BUILTIN = [
  { key: "uketori", label: "うけとり状況を選択", spoken: "うけとり", display: "text", multiple: false, column: "uketori", commentKey: "uketori",
    options: [{ label: "玄関" }, { label: "家族" }, { label: "不在" }] },
  { key: "__tabenokoshi", label: "食べ残し状況を選択", spoken: "食べ残し", display: "checkbox", multiple: false, commentKey: "kanshoku",
    options: [{ label: "なし", key: "kanshoku" }, { label: "半分", key: "hanbun" }, { label: "あり", key: "nokoshi" }, { label: "問題なし", key: "mondai_nashi" }] },
  { key: "__taicho", label: "体調を選択（複数選択可）", spoken: "体調", display: "checkbox", multiple: true, commentKey: "shokuyoku_teika",
    options: [{ label: "食欲低下", key: "shokuyoku_teika" }, { label: "顔色・元気", key: "kaoiro_genki" }, { label: "ふらつき", key: "furatsuki" }, { label: "体調他", key: "taicho_ta", sub: ["風邪"] }] },
  { key: "__jokyo", label: "状況を選択", spoken: "状況", display: "checkbox", multiple: false, commentKey: "koekake",
    options: [{ label: "声かけ", key: "koekake" }, { label: "新聞/郵便", key: "shinbun_yubin" }, { label: "玄関安全", key: "genkan_anzen" }, { label: "支援他", key: "shien_ta" }] },
];

// Columns the daily grid never shows (曜 has its own fixed column; メモ stays in the record).
const HIDDEN_COLUMNS = new Set(["youbi", "memo"]);

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  return v;
}

function cleanOptions(phrases) {
  const arr = parseJson(phrases, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((o) => o && typeof o.label === "string" && o.label.trim())
    .map((o) => ({ label: o.label.trim(), key: typeof o.key === "string" && o.key ? o.key : undefined, sub: Array.isArray(o.sub) ? o.sub : undefined }));
}

function readCategory(key, row, dailyFields) {
  const def = BUILTIN.find((d) => d.key === key);
  if (!row && !def) return null;
  const cfg = parseJson(row?.config, {}) || {};
  const type = row?.field_type || "";
  const display = cfg.display || (row ? (HEADING_TYPES.has(type) ? "text" : "checkbox") : def.display);
  const multiple =
    cfg.multiple ??
    (type === "heading_multi" || type === "group_multi" ? true : type === "heading" || type === "group_single" ? false : def ? def.multiple : false);
  const column = display === "text" ? cfg.column || (def && def.column) || key : undefined;
  const columnRow = column ? dailyFields.find((f) => f.field_key === column) : undefined;
  let options = cleanOptions(row?.phrases);
  if (!options.length && display === "text" && columnRow) {
    const phrases = parseJson(columnRow.phrases, []);
    options = (Array.isArray(phrases) ? phrases : []).filter((p) => typeof p === "string" && p.trim()).map((label) => ({ label }));
  }
  if (!options.length && def) options = def.options;
  const firstColumn = display === "text" ? column : (options.find((o) => o.key) || {}).key;
  const columnOrder = (dailyFields.find((f) => f.field_key === firstColumn) || {}).order_index ?? Number.MAX_SAFE_INTEGER;
  const label = (row && row.field_label && row.field_label.trim()) || (def && def.label) || key;
  return {
    key,
    label,
    spoken: def
      ? def.spoken
      : display === "text" && columnRow && columnRow.field_label
        ? columnRow.field_label
        : label.replace(/(状況)?を選択.*$/, "") || label,
    display,
    multiple,
    column,
    comment: cfg.comment ?? true,
    commentKey: cfg.commentKey || (def && def.commentKey) || firstColumn,
    options,
    columnOrder,
    rowOrder: typeof row?.order_index === "number" ? row.order_index : undefined,
  };
}

// Every category in マスター's 表示順 (same rules as the input screen).
function readCategories(dailyFields, targetRows) {
  const keys = [
    ...targetRows.map((r) => r.field_key),
    ...BUILTIN.map((d) => d.key).filter((k) => !targetRows.some((r) => r.field_key === k)),
  ];
  const all = keys
    .map((k) => readCategory(k, targetRows.find((r) => r.field_key === k), dailyFields))
    .filter(Boolean)
    .filter((c) =>
      c.display === "text"
        ? dailyFields.some((f) => f.field_key === c.column)
        : c.options.some((o) => dailyFields.some((f) => f.field_key === o.key))
    );
  const chosen = all.length > 0 && all.every((c) => c.rowOrder !== undefined);
  for (const c of all) c.order = chosen ? c.rowOrder : c.columnOrder;
  return all.sort((a, b) => a.order - b.order || a.columnOrder - b.columnOrder);
}

// Fill color per category: the color its first column always had (食事 peach,
// 体調 blue, 支援 green, 連絡 pink), else an unused one from this palette.
const PALETTE = [COLORS.GRAY, COLORS.YELLOW, COLORS.PINK, COLORS.GREEN, COLORS.BLUE, COLORS.PEACH];

/**
 * The daily grid's data columns (after the fixed 日/曜/配食者名/利用者確認印) and
 * the monthly tally groups.
 *   columns: { kind: "field", key, label, type: "checkbox"|"text", color, category? }
 *          | { kind: "comment", key (column the comment is stored on), label, color }
 *   tallyGroups: { name, color, items: [{ key, label }] }  (checkbox columns)
 */
function buildReportPlan(dailyFields, targetRows) {
  const byKey = Object.fromEntries(dailyFields.map((f) => [f.field_key, f]));
  const visible = (key) =>
    byKey[key] && !HIDDEN_COLUMNS.has(key) && byKey[key].field_label !== PATIENT_SELECT_FIELD_LABEL;
  const used = new Set();
  const columns = [];
  const tallyGroups = [];

  const categories = readCategories(dailyFields, targetRows);
  const firstKey = (c) => (c.display === "text" ? c.column : (c.options.find((o) => o.key) || {}).key);
  // Colors already taken by categories whose first column has a fixed group color.
  const takenColors = new Set(
    categories.map((c) => FIELD_GROUP[firstKey(c)]).filter(Boolean).map((g) => GROUP_COLOR[g])
  );
  categories.forEach((c, idx) => {
    const keys =
      c.display === "text"
        ? [c.column]
        : c.options.map((o) => o.key).filter((k, i, arr) => k && arr.indexOf(k) === i);
    const shown = keys.filter((k) => visible(k) && !used.has(k));
    let color = FIELD_GROUP[keys[0]] ? GROUP_COLOR[FIELD_GROUP[keys[0]]] : undefined;
    if (!color) {
      // A palette color no other category uses (cycling only if all are taken).
      color = PALETTE.find((p) => !takenColors.has(p)) || PALETTE[idx % PALETTE.length];
      takenColors.add(color);
    }
    shown.forEach((k) => {
      used.add(k);
      columns.push({
        kind: "field",
        key: k,
        label: byKey[k].field_label,
        type: byKey[k].field_type === "checkbox" ? "checkbox" : "text",
        color,
        category: c.key,
      });
    });
    if (c.comment && c.commentKey && byKey[c.commentKey]) {
      columns.push({ kind: "comment", key: c.commentKey, label: `${c.spoken}コメント`, color });
    }
    if (c.display === "checkbox") {
      const items = c.options
        .filter((o) => o.key && byKey[o.key] && byKey[o.key].field_type === "checkbox")
        .map((o) => ({ key: o.key, label: byKey[o.key].field_label }));
      if (items.length) tallyGroups.push({ name: c.spoken, color, items });
    }
  });

  // Report columns no category uses (e.g. 異変/不在, 連絡要) keep their place after.
  dailyFields
    .filter((f) => visible(f.field_key) && !used.has(f.field_key) && f.field_key !== "uketori")
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .forEach((f) => {
      used.add(f.field_key);
      columns.push({
        kind: "field",
        key: f.field_key,
        label: f.field_label,
        type: f.field_type === "checkbox" ? "checkbox" : "text",
        color: FIELD_GROUP[f.field_key] ? GROUP_COLOR[FIELD_GROUP[f.field_key]] : COLORS.WHITE,
      });
    });

  // The old fixed tally groups for columns no category tallies (連絡).
  const tallied = new Set(tallyGroups.flatMap((g) => g.items.map((i) => i.key)));
  for (const [name, keys] of Object.entries(TALLY_GROUPS)) {
    const items = keys
      .filter((k) => byKey[k] && byKey[k].field_type === "checkbox" && !tallied.has(k) && used.has(k))
      .map((k) => ({ key: k, label: byKey[k].field_label }));
    if (items.length) tallyGroups.push({ name, color: GROUP_COLOR[name] || COLORS.WHITE, items });
  }

  return { columns, tallyGroups };
}

// Flat tally rows with this month's counts: { group, color, label, count }.
function countTallies(tallyGroups, days) {
  return tallyGroups.flatMap((g) =>
    g.items.map((it) => ({
      group: g.name,
      color: g.color,
      label: it.label,
      count: days.reduce((n, d) => n + (isChecked((d.values || {})[it.key]) ? 1 : 0), 0),
    }))
  );
}

// Loads the master rows the plan is built from.
async function loadPlanFields(pool) {
  const [daily, target] = await Promise.all([
    pool.query(`SELECT * FROM status_fields WHERE screen_key='daily_status' ORDER BY order_index, field_key`),
    pool.query(`SELECT * FROM status_fields WHERE screen_key=$1 ORDER BY order_index, field_key`, [TARGET_SCREEN_KEY]),
  ]);
  const norm = (r) => ({ ...r, phrases: parseJson(r.phrases, []), config: parseJson(r.config, {}) || {} });
  return { dailyFields: daily.rows.map(norm), targetRows: target.rows.map(norm) };
}

module.exports = { buildReportPlan, countTallies, loadPlanFields, readCategories };
