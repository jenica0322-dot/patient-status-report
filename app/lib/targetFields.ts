// app/lib/targetFields.ts
// The 日次記録 categories asked on Status Input (うけとり, 食べ残し, 体調, 状況
// and any added in マスター) — one model shared by the input screen and the
// マスター screen, so both always agree.
//
// Every category has the same settings, each configured independently in
// マスター (stored on its daily_target row: label, options in `phrases`, the
// rest in `config` — migration 010):
//   - 選択方式: 単一 / 複数選択
//   - 報告書の表示:
//       "text"     — one 報告書 column holds the chosen name(s) (「、」-joined
//                    when 複数), e.g. うけとり → 「玄関」.
//       "checkbox" — each option ticks its own 報告書 column (a checkbox
//                    column; on a text column the option's name is written).
//   - options (選択肢) with follow-up choices (追加選択肢, saved as their name)
//   - コメント入力 on/off (the comment is stored on `commentKey`'s column)
// Nothing here is specific to one category except the built-in defaults used
// until a category is first saved in マスター.

// ---------- Runtime picker (Status Input) ----------

// A picker's option at runtime. `next` = follow-up choices (the option itself
// isn't saved). `listValue` = several options share one column (multiple
// choice, text display): the column holds the picked names joined by 「、」.
export type GroupOption = { label: string; key?: string; value?: any; next?: GroupOption[]; listValue?: boolean };
export type GroupTargetField = {
  field_key: string;
  // The master label — shown as the heading above the choices.
  field_label: string;
  // Short name read out by the voice-over (e.g. 体調), not the full heading.
  spokenLabel: string;
  // Every name that, said aloud, opens this category: its 報告書の列名
  // (text display), its short name and its full マスター label.
  voiceNames: string[];
  // Where the category's comment is stored.
  anchorKey: string;
  options: GroupOption[];
  multiple?: boolean;
  // コメント入力 shown for this category.
  comment?: boolean;
};

export const UKETORI_FIELD_KEY = "uketori";
export const TARGET_GROUP_SCREEN_KEY = "daily_target";
// 問題なし's column — picking the option saved here runs the no-issues
// shortcut (完食 + no 体調 + save), whatever its label says. A rule of the
// 問題なし column, not of a category.
export const NO_ISSUES_KEY = "mondai_nashi";

export const LIST_SEP = "、";
export function listValues(v: unknown): string[] {
  return typeof v === "string" && v ? v.split(LIST_SEP).filter(Boolean) : [];
}

// ---------- Stored config ----------

// One option as stored (daily_target row's phrases). `key` = the 報告書 column
// it ticks (checkbox display only). `sub` = follow-up choices.
export type CategoryOption = { label: string; key?: string; sub?: string[] };

export type ReportDisplay = "text" | "checkbox";

// Stored in the daily_target row's `config`.
export type StoredCategorySettings = {
  display?: ReportDisplay;
  multiple?: boolean;
  column?: string; // text display: the column holding the answer
  comment?: boolean; // コメント入力 on Status Input
  commentKey?: string; // column the comment is stored on
};

// daily_target row types (kept in sync with config for older code / data).
export const HEADING_FIELD_TYPE = "heading";
export const HEADING_MULTI_FIELD_TYPE = "heading_multi";
const HEADING_TYPES = new Set([HEADING_FIELD_TYPE, HEADING_MULTI_FIELD_TYPE]);
export const GROUP_SINGLE_FIELD_TYPE = "group_single";
export const GROUP_MULTI_FIELD_TYPE = "group_multi";

type MasterRow = {
  field_key: string;
  field_label: string;
  field_type?: string;
  phrases?: unknown;
  order_index?: number;
  config?: unknown;
};

// Fallbacks, used if the うけとり master rows have no label / options.
export const UKETORI_DEFAULT_OPTIONS = ["玄関", "家族", "不在"];
export const UKETORI_DEFAULT_LABEL = "うけとり状況を選択";

// Built-in categories' starting settings — used only until a category is
// saved in マスター (afterwards its row is the source of truth).
type BuiltinDef = {
  field_key: string;
  label: string;
  spokenLabel: string;
  display: ReportDisplay;
  multiple: boolean;
  column?: string;
  commentKey: string;
  options: CategoryOption[];
};
export const BUILTIN_CATEGORIES: BuiltinDef[] = [
  {
    field_key: UKETORI_FIELD_KEY,
    label: UKETORI_DEFAULT_LABEL,
    spokenLabel: "うけとり",
    display: "text",
    multiple: false,
    column: UKETORI_FIELD_KEY,
    commentKey: UKETORI_FIELD_KEY,
    options: UKETORI_DEFAULT_OPTIONS.map((label) => ({ label })),
  },
  {
    field_key: "__tabenokoshi",
    label: "食べ残し状況を選択",
    spokenLabel: "食べ残し",
    display: "checkbox",
    multiple: false,
    commentKey: "kanshoku",
    options: [
      { label: "なし", key: "kanshoku" },
      { label: "半分", key: "hanbun" },
      { label: "あり", key: "nokoshi" },
      { label: "問題なし", key: NO_ISSUES_KEY },
    ],
  },
  {
    field_key: "__taicho",
    label: "体調を選択（複数選択可）",
    spokenLabel: "体調",
    display: "checkbox",
    multiple: true,
    commentKey: "shokuyoku_teika",
    options: [
      { label: "食欲低下", key: "shokuyoku_teika" },
      { label: "顔色・元気", key: "kaoiro_genki" },
      { label: "ふらつき", key: "furatsuki" },
      { label: "体調他", key: "taicho_ta", sub: ["風邪"] },
    ],
  },
  {
    field_key: "__jokyo",
    label: "状況を選択",
    spokenLabel: "状況",
    display: "checkbox",
    multiple: false,
    commentKey: "koekake",
    options: [
      { label: "声かけ", key: "koekake" },
      { label: "新聞/郵便", key: "shinbun_yubin" },
      { label: "玄関安全", key: "genkan_anzen" },
      { label: "支援他", key: "shien_ta" },
    ],
  },
];

export const isBuiltinCategory = (key: string) => BUILTIN_CATEGORIES.some((d) => d.field_key === key);

function cleanOption(o: any): CategoryOption | null {
  if (!o || typeof o.label !== "string" || !o.label.trim()) return null;
  const sub = Array.isArray(o.sub) ? o.sub.filter((s: unknown) => typeof s === "string" && s.trim()) : [];
  return {
    label: o.label.trim(),
    ...(typeof o.key === "string" && o.key ? { key: o.key } : {}),
    ...(sub.length ? { sub } : {}),
  };
}

function storedOptions(row: MasterRow | undefined): CategoryOption[] {
  if (!Array.isArray(row?.phrases)) return [];
  return (row!.phrases as unknown[]).map(cleanOption).filter((o): o is CategoryOption => !!o);
}

// One category's full settings, as マスター shows them.
export type CategoryConfig = {
  field_key: string;
  builtin: boolean;
  label: string;
  spokenLabel: string;
  // 報告書の列名 of the text column (text display only).
  reportColumnName?: string;
  display: ReportDisplay;
  multiple: boolean;
  column?: string;
  comment: boolean;
  commentKey?: string;
  options: CategoryOption[];
  // Effective position on Status Input / in マスター (lower = earlier).
  order: number;
  // Fallback position: where its (first) 報告書 column sits.
  columnOrder: number;
  // Position chosen in マスター, if any.
  rowOrder?: number;
};

// A category's short spoken name from its マスター ラベル: drops the
// 「…を選択（複数選択可）」 heading wording and a trailing 状況 — unless 状況
// is the whole name (「状況を選択」→「状況」).
export function categoryNameFromLabel(label: string): string {
  const base = label.trim().replace(/を選択.*$/, "").trim();
  return base.replace(/状況$/, "") || base;
}

function settingsOf(row: MasterRow | undefined): StoredCategorySettings {
  return row?.config && typeof row.config === "object" ? (row.config as StoredCategorySettings) : {};
}

// Reads one category from its daily_target row (and/or built-in default).
function readCategory(key: string, row: MasterRow | undefined, dailyFields: MasterRow[]): CategoryConfig | null {
  const def = BUILTIN_CATEGORIES.find((d) => d.field_key === key);
  if (!row && !def) return null;
  const cfg = settingsOf(row);
  const type = row?.field_type ?? "";
  // Older rows: heading* = text display on its own column; group* = checkbox.
  const display: ReportDisplay =
    cfg.display ?? (row ? (HEADING_TYPES.has(type) ? "text" : "checkbox") : def!.display);
  const multiple =
    cfg.multiple ??
    (type === HEADING_MULTI_FIELD_TYPE || type === GROUP_MULTI_FIELD_TYPE
      ? true
      : type === HEADING_FIELD_TYPE || type === GROUP_SINGLE_FIELD_TYPE
        ? false
        : def?.multiple ?? false);
  const column = display === "text" ? cfg.column ?? def?.column ?? key : undefined;
  const columnRow = column ? dailyFields.find((f) => f.field_key === column) : undefined;

  let options = storedOptions(row);
  if (!options.length && display === "text" && columnRow) {
    // Older text categories keep plain option names on their column's phrases.
    const phrases = Array.isArray(columnRow.phrases)
      ? (columnRow.phrases as unknown[]).filter((p): p is string => typeof p === "string" && !!p.trim())
      : [];
    options = phrases.map((label) => ({ label }));
  }
  if (!options.length && def) options = def.options;

  const firstColumn = display === "text" ? column : options.find((o) => o.key)?.key;
  const columnOrder = dailyFields.find((f) => f.field_key === firstColumn)?.order_index ?? Number.MAX_SAFE_INTEGER;
  const label = row?.field_label?.trim() || def?.label || key;
  return {
    field_key: key,
    builtin: !!def,
    label,
    // Always from マスター, so a rename there changes what's announced and
    // recognized: the 報告書の列名 (text display), otherwise the category's
    // ラベル shortened (「食べ残し状況を選択」→「食べ残し」). The built-in
    // name is only a last resort when neither gives anything.
    spokenLabel:
      (display === "text" && columnRow?.field_label?.trim()) ||
      categoryNameFromLabel(label) ||
      def?.spokenLabel ||
      label,
    reportColumnName: display === "text" ? columnRow?.field_label?.trim() || undefined : undefined,
    display,
    multiple,
    column,
    comment: cfg.comment ?? true,
    commentKey: cfg.commentKey ?? def?.commentKey ?? firstColumn,
    options,
    order: columnOrder,
    columnOrder,
    rowOrder: typeof row?.order_index === "number" ? row.order_index : undefined,
  };
}

// Every category in Status Input order. Once an order has been chosen in
// マスター (every category then has a row holding its position) that order
// is used; until then each sits where its (first) 報告書 column is. The
// 報告書's own column order is never affected.
export function allCategoryConfigs(dailyFields: MasterRow[], targetRows: MasterRow[]): CategoryConfig[] {
  const keys = [
    ...targetRows.map((r) => r.field_key),
    ...BUILTIN_CATEGORIES.map((d) => d.field_key).filter((k) => !targetRows.some((r) => r.field_key === k)),
  ];
  const all = keys
    .map((k) => readCategory(k, targetRows.find((r) => r.field_key === k), dailyFields))
    .filter((c): c is CategoryConfig => !!c)
    // A category applies only when a column it saves into exists (built-in
    // defaults on a screen without those columns are left out).
    .filter(
      (c) =>
        !dailyFields.length ||
        (c.display === "text"
          ? dailyFields.some((f) => f.field_key === c.column)
          : c.options.some((o) => dailyFields.some((f) => f.field_key === o.key)))
    );
  const chosen = all.length > 0 && all.every((c) => c.rowOrder !== undefined);
  for (const c of all) c.order = chosen ? c.rowOrder! : c.columnOrder;
  return all.sort((a, b) => a.order - b.order || a.columnOrder - b.columnOrder);
}

// The 報告書 columns used by some category's text display (an option can't
// tick another category's answer column).
export function categoryTextColumns(dailyFields: MasterRow[], targetRows: MasterRow[]): Set<string> {
  return new Set(
    allCategoryConfigs(dailyFields, targetRows)
      .map((c) => c.column)
      .filter((k): k is string => !!k)
  );
}

// The daily_target row that stores `cfg` (for saving).
export function categoryRow(cfg: Pick<CategoryConfig, "field_key" | "label" | "display" | "multiple" | "column" | "comment" | "commentKey" | "options">, order: number) {
  const settings: StoredCategorySettings = {
    display: cfg.display,
    multiple: cfg.multiple,
    comment: cfg.comment,
    ...(cfg.display === "text" && cfg.column ? { column: cfg.column } : {}),
    ...(cfg.commentKey ? { commentKey: cfg.commentKey } : {}),
  };
  return {
    screen_key: TARGET_GROUP_SCREEN_KEY,
    field_key: cfg.field_key,
    field_label: cfg.label,
    field_type:
      cfg.display === "text"
        ? cfg.multiple
          ? HEADING_MULTI_FIELD_TYPE
          : HEADING_FIELD_TYPE
        : cfg.multiple
          ? GROUP_MULTI_FIELD_TYPE
          : GROUP_SINGLE_FIELD_TYPE,
    phrases: cfg.options.map((o) => ({
      label: o.label,
      ...(cfg.display === "checkbox" && o.key ? { key: o.key } : {}),
      ...(o.sub?.length ? { sub: o.sub } : {}),
    })),
    order_index: order,
    config: settings,
  };
}

// Option names as one flat list (follow-ups as 「体調他：風邪」), for lists.
export function optionDisplayNames(options: CategoryOption[]): string[] {
  return options.flatMap((o) => (o.sub?.length ? o.sub.map((s) => `${o.label}：${s}`) : [o.label]));
}

// ---------- Runtime pickers ----------

// Builds the Status Input pickers from the master, in マスター's order. On a
// checkbox column a pick stores true; on a text column it stores the chosen
// name (several names 「、」-joined for 複数選択 text display).
export function buildGroupTargetFields(targetRows: MasterRow[], dailyFields: MasterRow[]): GroupTargetField[] {
  const typeOf = (key?: string) => dailyFields.find((f) => f.field_key === key)?.field_type ?? "checkbox";
  return allCategoryConfigs(dailyFields, targetRows).map((c): GroupTargetField => {
    const listValue = (c.display === "text" && c.multiple) || undefined;
    const options = c.options
      .map((o): GroupOption | null => {
        const key = c.display === "text" ? c.column : o.key;
        if (!key) return null;
        if (o.sub?.length) {
          return { label: o.label, next: o.sub.map((s) => ({ label: s, key, value: s, listValue })) };
        }
        return { label: o.label, key, value: typeOf(key) === "checkbox" ? true : o.label, listValue };
      })
      .filter((o): o is GroupOption => !!o);
    return {
      field_key: c.field_key,
      field_label: c.label,
      spokenLabel: c.spokenLabel,
      voiceNames: [
        ...new Set(
          [c.reportColumnName, c.spokenLabel, categoryNameFromLabel(c.label), c.label]
            .map((n) => n?.trim())
            .filter((n): n is string => !!n)
        ),
      ],
      anchorKey: c.commentKey ?? c.column ?? options[0]?.key ?? c.field_key,
      options,
      multiple: c.multiple,
      comment: c.comment,
    };
  });
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
  玄関: ["げんかん"],
  家族: ["かぞく"],
  不在: ["ふざい"],
  半分: ["はんぶん"],
  問題なし: ["もんだいなし", "問題無し"],
  食欲低下: ["しょくよくていか", "食欲"],
  "顔色・元気": ["かおいろげんき", "顔色", "元気"],
  ふらつき: ["ふらふら"],
  体調他: ["たいちょうた", "体調その他"],
  風邪: ["かぜ", "風"],
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
