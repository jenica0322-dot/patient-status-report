// app/lib/targetFields.ts
// The 日次記録 categories asked on Status Input — うけとり, 食べ残し, 体調 and
// any category added in マスター — shared by the input screen and the マスター
// screen so both always show the same categories and options.
//
// Every category is edited the same way in マスター (label, 単一/複数選択,
// options with follow-up choices) and shown the same way on Status Input.
// They differ only in where an answer is saved:
//   - "group" (食べ残し / 体調): each option saves into its own report column
//     (a daily_status checkbox/text row). Their config is a daily_target row
//     keyed "__tabenokoshi" / "__taicho" (kept out of daily_status so the
//     報告書 doesn't turn them into columns).
//   - "own" (うけとり, categories added in マスター): one daily_status column
//     holding the chosen label(s). Its config (label shown on screen, options,
//     single/multiple) is a daily_target row with the same field_key; the
//     daily_status row's field_label stays the 報告書 column header.

// A picker's option at runtime. `next` = follow-up choices (the option itself
// isn't saved). `listValue` = several options share one column (a multiple-
// choice "own" category): the column holds the picked labels joined by 「、」.
export type GroupOption = { label: string; key?: string; value?: any; next?: GroupOption[]; listValue?: boolean };
export type GroupTargetField = {
  field_key: string;
  // The master label — shown as the heading above the choices.
  field_label: string;
  // Short name read out by the voice-over (e.g. 体調), not the full heading.
  spokenLabel: string;
  // Where the category's comment is stored (its first / own column).
  anchorKey: string;
  options: GroupOption[];
  multiple?: boolean;
};

export const UKETORI_FIELD_KEY = "uketori";
export const TARGET_GROUP_SCREEN_KEY = "daily_target";
// 問題なし's column — picking the option saved here runs the no-issues
// shortcut (完食 + no 体調 + save), whatever its label says.
export const NO_ISSUES_KEY = "mondai_nashi";

// Several picked labels in one column (multiple-choice "own" category).
export const LIST_SEP = "、";
export function listValues(v: unknown): string[] {
  return typeof v === "string" && v ? v.split(LIST_SEP).filter(Boolean) : [];
}

// ---------- Stored config ----------

// One option as stored in the master (daily_target row's phrases). `key` is
// the report column — only for 食べ残し/体調 ("group"); an "own" category's
// options all save into its own column. `sub` = follow-up choices, saved as
// their label.
export type CategoryOption = { label: string; key?: string; sub?: string[] };

// daily_target row types. "_multi" / "_single" record 複数/単一選択; plain
// "group" (older rows) keeps the built-in default.
export const HEADING_FIELD_TYPE = "heading";
export const HEADING_MULTI_FIELD_TYPE = "heading_multi";
const HEADING_TYPES = new Set([HEADING_FIELD_TYPE, HEADING_MULTI_FIELD_TYPE]);
export const GROUP_SINGLE_FIELD_TYPE = "group_single";
export const GROUP_MULTI_FIELD_TYPE = "group_multi";

type MasterRow = { field_key: string; field_label: string; field_type?: string; phrases?: unknown; order_index?: number };

// Fallbacks, used if the うけとり master rows have no label / options.
export const UKETORI_DEFAULT_OPTIONS = ["玄関", "家族", "不在"];
export const UKETORI_DEFAULT_LABEL = "うけとり状況を選択";

// Fixed per-group facts (the columns behind 食べ残し / 体調) and defaults.
export const TARGET_GROUP_DEFS: {
  field_key: string;
  anchorKey: string;
  multiple?: boolean;
  spokenLabel: string;
  defaultLabel: string;
  defaultOptions: CategoryOption[];
}[] = [
  {
    field_key: "__tabenokoshi",
    anchorKey: "kanshoku",
    spokenLabel: "食べ残し",
    defaultLabel: "食べ残し状況を選択",
    defaultOptions: [
      { label: "なし", key: "kanshoku" },
      { label: "半分", key: "hanbun" },
      { label: "あり", key: "nokoshi" },
      // Picking this also checks 完食, clears 体調, skips that step and saves
      // the record at once (see applyNoIssues in StatusMatcher).
      { label: "問題なし", key: NO_ISSUES_KEY },
    ],
  },
  {
    field_key: "__taicho",
    anchorKey: "shokuyoku_teika",
    multiple: true,
    spokenLabel: "体調",
    defaultLabel: "体調を選択（複数選択可）",
    defaultOptions: [
      { label: "食欲低下", key: "shokuyoku_teika" },
      { label: "顔色・元気", key: "kaoiro_genki" },
      { label: "ふらつき", key: "furatsuki" },
      { label: "体調他", key: "taicho_ta", sub: ["風邪"] },
    ],
  },
  {
    // 状況: 単一選択 — pick one item (it ticks its own 報告書 column; 支援他 is a
    // text column, so it saves 「支援他」 there) and the flow moves on.
    field_key: "__jokyo",
    anchorKey: "koekake",
    spokenLabel: "状況",
    defaultLabel: "状況を選択",
    defaultOptions: [
      { label: "声かけ", key: "koekake" },
      { label: "新聞/郵便", key: "shinbun_yubin" },
      { label: "玄関安全", key: "genkan_anzen" },
      { label: "支援他", key: "shien_ta" },
    ],
  },
];

export const isGroupKey = (fieldKey: string) => TARGET_GROUP_DEFS.some((d) => d.field_key === fieldKey);

function cleanOption(o: any, needKey: boolean): CategoryOption | null {
  if (!o || typeof o.label !== "string" || !o.label.trim()) return null;
  if (needKey && (typeof o.key !== "string" || !o.key)) return null;
  const sub = Array.isArray(o.sub) ? o.sub.filter((s: unknown) => typeof s === "string" && s.trim()) : [];
  return { label: o.label.trim(), ...(needKey ? { key: o.key } : {}), ...(sub.length ? { sub } : {}) };
}

function storedOptions(row: MasterRow | undefined, needKey: boolean): CategoryOption[] {
  if (!Array.isArray(row?.phrases)) return [];
  return (row!.phrases as unknown[]).map((o) => cleanOption(o, needKey)).filter((o): o is CategoryOption => !!o);
}

// The editable config of one category, as マスター shows it.
export type CategoryConfig = {
  kind: "group" | "own";
  field_key: string;
  label: string;
  multiple: boolean;
  options: CategoryOption[];
  // Effective position on Status Input / in マスター (lower = earlier).
  order: number;
  // Fallback position: where the category's (first) report column sits.
  columnOrder: number;
  // Position chosen in マスター (its daily_target row's order_index), if any.
  rowOrder?: number;
};

export function groupConfig(fieldKey: string, groupRows: MasterRow[], dailyFields: MasterRow[] = []): CategoryConfig {
  const def = TARGET_GROUP_DEFS.find((d) => d.field_key === fieldKey)!;
  const row = groupRows.find((r) => r.field_key === fieldKey);
  const opts = storedOptions(row, true);
  const multiple =
    row?.field_type === GROUP_MULTI_FIELD_TYPE ? true : row?.field_type === GROUP_SINGLE_FIELD_TYPE ? false : !!def.multiple;
  const anchor = dailyFields.find((f) => f.field_key === def.anchorKey);
  return {
    kind: "group",
    field_key: fieldKey,
    label: row?.field_label?.trim() || def.defaultLabel,
    multiple,
    options: opts.length ? opts : def.defaultOptions,
    order: anchor?.order_index ?? Number.MAX_SAFE_INTEGER,
    columnOrder: anchor?.order_index ?? Number.MAX_SAFE_INTEGER,
    rowOrder: typeof row?.order_index === "number" ? row.order_index : undefined,
  };
}

// A daily_status field is shown as an "own" category (on Status Input and in
// マスター's list) when it has a daily_target heading row. うけとり always is.
// The built-in report-only columns (完食, 声かけ, メモ, …) have none, so they
// stay hidden.
export function isInputCategory(fieldKey: string, groupRows: MasterRow[]): boolean {
  return (
    fieldKey === UKETORI_FIELD_KEY ||
    groupRows.some((r) => r.field_key === fieldKey && HEADING_TYPES.has(r.field_type ?? ""))
  );
}

export function ownConfig(field: MasterRow, groupRows: MasterRow[]): CategoryConfig {
  const row = groupRows.find((r) => r.field_key === field.field_key && HEADING_TYPES.has(r.field_type ?? ""));
  let options = storedOptions(row, false);
  if (!options.length) {
    // Older rows keep plain option names in the daily_status phrases.
    const phrases = Array.isArray(field.phrases)
      ? (field.phrases as unknown[]).filter((p): p is string => typeof p === "string" && !!p.trim())
      : [];
    const names = phrases.length ? phrases : field.field_key === UKETORI_FIELD_KEY ? UKETORI_DEFAULT_OPTIONS : [];
    options = names.map((label) => ({ label }));
  }
  return {
    kind: "own",
    field_key: field.field_key,
    label:
      row?.field_label?.trim() ||
      (field.field_key === UKETORI_FIELD_KEY ? UKETORI_DEFAULT_LABEL : field.field_label),
    multiple: row?.field_type === HEADING_MULTI_FIELD_TYPE,
    options,
    order: field.order_index ?? 0,
    columnOrder: field.order_index ?? 0,
    rowOrder: typeof row?.order_index === "number" ? row.order_index : undefined,
  };
}

// Every category in Status Input order. Once an order has been chosen in
// マスター (every category then has a daily_target row holding its position),
// that order is used; until then each sits where its (first) report column
// is. The 報告書's own column order is never affected.
export function allCategoryConfigs(dailyFields: MasterRow[], groupRows: MasterRow[]): CategoryConfig[] {
  const own = dailyFields.filter((f) => isInputCategory(f.field_key, groupRows)).map((f) => ownConfig(f, groupRows));
  // A built-in group only applies when its first column exists.
  const groups = TARGET_GROUP_DEFS.filter(
    (d) => !dailyFields.length || dailyFields.some((f) => f.field_key === d.anchorKey)
  ).map((d) => groupConfig(d.field_key, groupRows, dailyFields));
  const all = [...own, ...groups];
  const chosen = all.length > 0 && all.every((c) => c.rowOrder !== undefined);
  for (const c of all) c.order = chosen ? c.rowOrder! : c.columnOrder;
  // Ties (e.g. two at the same position) keep column order.
  return all.sort((a, b) => a.order - b.order || a.columnOrder - b.columnOrder);
}

// Option names as one flat list (follow-ups as 「体調他：風邪」), for lists.
export function optionDisplayNames(options: CategoryOption[]): string[] {
  return options.flatMap((o) => (o.sub?.length ? o.sub.map((s) => `${o.label}：${s}`) : [o.label]));
}

// ---------- Runtime pickers ----------

// Builds the Status Input pickers from the master. A checkbox column stores
// true when picked; a text column (and an "own" category's column) stores the
// chosen label (e.g. 体調他 → 「風邪」).
export function buildGroupTargetFields(groupRows: MasterRow[], dailyFields: MasterRow[]): GroupTargetField[] {
  const typeOf = (key: string) => dailyFields.find((f) => f.field_key === key)?.field_type ?? "checkbox";
  const groups = TARGET_GROUP_DEFS.map((def): GroupTargetField => {
    const cfg = groupConfig(def.field_key, groupRows, dailyFields);
    return {
      field_key: def.field_key,
      field_label: cfg.label,
      spokenLabel: def.spokenLabel,
      anchorKey: def.anchorKey,
      multiple: cfg.multiple,
      options: cfg.options.map((o): GroupOption => {
        if (o.sub?.length) {
          return { label: o.label, next: o.sub.map((s) => ({ label: s, key: o.key, value: s })) };
        }
        return { label: o.label, key: o.key, value: typeOf(o.key!) === "checkbox" ? true : o.label };
      }),
    };
  });
  const own = dailyFields
    .filter((f) => isInputCategory(f.field_key, groupRows))
    .map((f): GroupTargetField => {
      const cfg = ownConfig(f, groupRows);
      const key = f.field_key;
      const listValue = cfg.multiple || undefined;
      return {
        field_key: key,
        field_label: cfg.label,
        spokenLabel: f.field_label,
        anchorKey: key,
        multiple: cfg.multiple,
        options: cfg.options.map((o): GroupOption => {
          if (o.sub?.length) {
            return { label: o.label, next: o.sub.map((s) => ({ label: s, key, value: s, listValue })) };
          }
          return { label: o.label, key, value: o.label, listValue };
        }),
      };
    });
  // Same order as マスター shows (allCategoryConfigs).
  const order = allCategoryConfigs(dailyFields, groupRows).map((c) => c.field_key);
  const pos = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...groups, ...own].sort((a, b) => pos(a.field_key) - pos(b.field_key));
}

// Current pickers. Starts from the built-in defaults; the input screen
// replaces it with the master's version once loaded (setGroupTargetFields).
// Read through getGroupTargetFields() — a plain function export rather than a
// reassigned `export let`, which dev hot-reload (Turbopack HMR) can leave
// half-updated in an open tab.
let currentGroupTargetFields: GroupTargetField[] = buildGroupTargetFields([], []);

export function getGroupTargetFields(): GroupTargetField[] {
  return currentGroupTargetFields;
}

export function setGroupTargetFields(groups: GroupTargetField[]) {
  currentGroupTargetFields = groups;
}

// ---------- Voice ----------

// Other ways the speech recognizer writes a choice — kana readings and common
// mis-hearings — so e.g. saying 「かぜ」 (often transcribed かぜ / カゼ / 風)
// still picks 風邪. Keyed by the option's label; katakana is folded to
// hiragana before matching, so only hiragana forms are needed here.
export const CHOICE_READINGS: Record<string, string[]> = {
  // うけとり
  玄関: ["げんかん"],
  家族: ["かぞく"],
  不在: ["ふざい"],
  // 食べ残し
  半分: ["はんぶん"],
  問題なし: ["もんだいなし", "問題無し"],
  // 体調
  食欲低下: ["しょくよくていか", "食欲"],
  "顔色・元気": ["かおいろげんき", "顔色", "元気"],
  ふらつき: ["ふらふら"],
  体調他: ["たいちょうた", "体調その他"],
  風邪: ["かぜ", "風"],
  // 状況
  声かけ: ["こえかけ", "声掛け", "声がけ", "こえがけ"],
  "新聞/郵便": ["しんぶんゆうびん", "新聞", "郵便", "しんぶん", "ゆうびん"],
  玄関安全: ["げんかんあんぜん"],
  支援他: ["しえんた", "支援", "支援その他"],
};

// The label plus its alternative spellings, for voice matching.
export function choiceSpellings(label: string): string[] {
  return [label, ...(CHOICE_READINGS[label] ?? [])];
}

export function groupAllOptions(options: GroupOption[]): GroupOption[] {
  return options.flatMap((o) => (o.next ? [o, ...groupAllOptions(o.next)] : [o]));
}
