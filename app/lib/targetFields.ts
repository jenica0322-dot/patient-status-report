// app/lib/targetFields.ts
// The three 日次記録 main categories asked on Status Input — うけとり, 食べ残し,
// 体調 — shared by the input screen and the マスター screen so both always
// show the same categories and options.
//
// うけとり is a real status_fields row (screen_key daily_status); its options
// are its master phrases.
// 食べ残し / 体調 are picker-only: each option saves into an existing report
// column (a daily_status row). Their label and options are master rows under
// screen_key "daily_target" (kept out of daily_status so the 報告書 doesn't
// turn them into columns). Behaviour that depends on them — single vs.
// multiple choice, which column holds the comment — stays fixed here.

// Picker-only Target Fields that sit in front of an existing report column group
// and save into those columns. Picking an option sets its own column and clears
// whatever another option in the same picker had set, so only the final choice
// stays in the report. `next` shows a follow-up choice instead of saving.
// `multiple` pickers instead toggle each option on/off independently and only
// move on to the next Target Field when 次へ is said.
export type GroupOption = { label: string; key?: string; value?: any; next?: GroupOption[] };
export type GroupTargetField = {
  field_key: string;
  // The master label — shown as the heading above the choices.
  field_label: string;
  // Short name read out by the voice-over (e.g. 体調), not the full heading.
  spokenLabel: string;
  anchorKey: string;
  options: GroupOption[];
  multiple?: boolean;
};

export const UKETORI_FIELD_KEY = "uketori";
export const TARGET_GROUP_SCREEN_KEY = "daily_target";
// 問題なし's column — picking the option saved here runs the no-issues
// shortcut (完食 + no 体調 + save), whatever its label says.
export const NO_ISSUES_KEY = "mondai_nashi";

// Fallback only, used if the うけとり master row has no phrases.
export const UKETORI_DEFAULT_OPTIONS = ["玄関", "家族", "不在"];

// The うけとり label shown on Status Input and in マスター. Kept in its own
// daily_target row: the daily_status うけとり row's field_label is the 報告書
// column header (and what the voice-over says), so it stays 「うけとり」.
export const UKETORI_DEFAULT_LABEL = "うけとり状況を選択";

export function uketoriLabel(groupRows: MasterRow[]): string {
  const row = groupRows.find((r) => r.field_key === UKETORI_FIELD_KEY);
  return row?.field_label?.trim() || UKETORI_DEFAULT_LABEL;
}

export const uketoriOptions = (field?: { phrases?: string[] } | null): string[] =>
  field?.phrases?.length ? field.phrases : UKETORI_DEFAULT_OPTIONS;

// How a 食べ残し / 体調 option is stored in the master (status_fields.phrases):
// its label, the report column it saves into, and — for a parent like 体調他 —
// follow-up choices whose label is saved as text into that column.
export type StoredGroupOption = { label: string; key: string; sub?: string[] };

// Fixed per-group behaviour (not editable in the master).
export const TARGET_GROUP_DEFS: {
  field_key: string;
  anchorKey: string;
  multiple?: boolean;
  spokenLabel: string;
  defaultLabel: string;
  defaultOptions: StoredGroupOption[];
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
];

type MasterRow = { field_key: string; field_label: string; field_type?: string; phrases?: unknown };

function isStoredOption(o: any): o is StoredGroupOption {
  return o && typeof o.label === "string" && o.label.trim() !== "" && typeof o.key === "string" && o.key !== "";
}

// The stored options for a group: its master row if it has valid ones,
// otherwise the built-in defaults.
export function storedGroupOptions(fieldKey: string, groupRows: MasterRow[]): StoredGroupOption[] {
  const def = TARGET_GROUP_DEFS.find((d) => d.field_key === fieldKey);
  const row = groupRows.find((r) => r.field_key === fieldKey);
  const opts = Array.isArray(row?.phrases) ? (row!.phrases as unknown[]).filter(isStoredOption) : [];
  return opts.length ? opts : def?.defaultOptions ?? [];
}

export function storedGroupLabel(fieldKey: string, groupRows: MasterRow[]): string {
  const def = TARGET_GROUP_DEFS.find((d) => d.field_key === fieldKey);
  const row = groupRows.find((r) => r.field_key === fieldKey);
  return row?.field_label?.trim() || def?.defaultLabel || fieldKey;
}

// Builds the runtime pickers from the master. A checkbox column stores true
// when picked; a text column stores the chosen label (e.g. 体調他 → 「風邪」).
export function buildGroupTargetFields(groupRows: MasterRow[], dailyFields: MasterRow[]): GroupTargetField[] {
  const typeOf = (key: string) => dailyFields.find((f) => f.field_key === key)?.field_type ?? "checkbox";
  return TARGET_GROUP_DEFS.map((def) => ({
    field_key: def.field_key,
    field_label: storedGroupLabel(def.field_key, groupRows),
    spokenLabel: def.spokenLabel,
    anchorKey: def.anchorKey,
    multiple: def.multiple,
    options: storedGroupOptions(def.field_key, groupRows).map((o): GroupOption => {
      if (o.sub?.length) {
        return { label: o.label, next: o.sub.map((s) => ({ label: s, key: o.key, value: s })) };
      }
      return { label: o.label, key: o.key, value: typeOf(o.key) === "checkbox" ? true : o.label };
    }),
  }));
}

// Current pickers. Starts from the built-in defaults; the input screen
// replaces it with the master's version once loaded (setGroupTargetFields).
// Importers see the update through the live ES module binding.
export let GROUP_TARGET_FIELDS: GroupTargetField[] = buildGroupTargetFields([], []);

export function setGroupTargetFields(groups: GroupTargetField[]) {
  GROUP_TARGET_FIELDS = groups;
}

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
};

// The label plus its alternative spellings, for voice matching.
export function choiceSpellings(label: string): string[] {
  return [label, ...(CHOICE_READINGS[label] ?? [])];
}

export function groupAllOptions(options: GroupOption[]): GroupOption[] {
  return options.flatMap((o) => (o.next ? [o, ...groupAllOptions(o.next)] : [o]));
}
