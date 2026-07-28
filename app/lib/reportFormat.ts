// app/lib/reportFormat.ts
// Formatting helpers shared by the on-screen monthly report grid. Mirrors the
// grouping/pairing logic in server/lib/xlsxReportBuilder.js so the screen and the
// Excel export read as the same document.

export interface ReportField {
  field_key: string;
  field_label: string;
  field_type: string;
  phrases: string[];
  order_index: number;
}

export type FieldValue = { value?: any; comment?: string } | any;

export const TALLY_GROUPS: Record<string, string[]> = {
  食事: ["kanshoku", "hanbun", "nokoshi"],
  体調: ["shokuyoku_teika", "kaoiro_genki", "furatsuki"],
  支援: ["koekake", "shinbun_yubin", "genkan_anzen"],
  連絡: ["ihen_fuzai", "renraku_you"],
};

export const FIELD_GROUP: Record<string, string> = {
  kanshoku: "食事",
  hanbun: "食事",
  nokoshi: "食事",
  shokuyoku_teika: "体調",
  kaoiro_genki: "体調",
  furatsuki: "体調",
  taicho_ta: "体調",
  koekake: "支援",
  shinbun_yubin: "支援",
  genkan_anzen: "支援",
  shien_ta: "支援",
  ihen_fuzai: "連絡",
  renraku_you: "連絡",
};

export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
export const CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨";

export function isChecked(fieldValue: FieldValue): boolean {
  if (fieldValue == null) return false;
  const v = typeof fieldValue === "object" ? fieldValue.value : fieldValue;
  return v === true || v === "✓" || v === "true";
}

export function rawValue(fieldValue: FieldValue): any {
  if (fieldValue == null) return "";
  return typeof fieldValue === "object" ? fieldValue.value ?? "" : fieldValue;
}

export function rawComment(fieldValue: FieldValue): string {
  if (fieldValue == null || typeof fieldValue !== "object") return "";
  return fieldValue.comment || "";
}

export function textWithComment(fieldValue: FieldValue): string {
  const v = rawValue(fieldValue);
  const c = rawComment(fieldValue);
  if (v === "" || v == null) return c ? `（${c}）` : "";
  return c ? `${v}（${c}）` : String(v);
}

export function checklistOptions(field: ReportField | undefined, fieldValue: FieldValue) {
  const selected = rawValue(fieldValue);
  const options = field?.phrases?.length ? field.phrases : [];
  if (!options.length) return [{ label: String(selected || ""), selected: true }];
  return options.map((opt) => ({ label: opt, selected: opt === selected }));
}

export interface CommentBlock {
  number: number;
  field: ReportField;
  freeTextField: ReportField | null;
  freeTextSuffix: string | null;
}

// Pairs each preset field with the free-text field that follows it (…_hitokoto / …_naiyo)
// so numbered blocks (①総合評価, ②食事状況…) fall out of field order instead of being
// hardcoded — stays correct if the master field list is edited later.
export function buildCommentBlocks(monthlyFields: ReportField[]): CommentBlock[] {
  const ordered = monthlyFields.slice().sort((a, b) => a.order_index - b.order_index);
  const bodyStart = ordered.findIndex((f) => f.field_key === "sogo_hyoka");
  const sohyoIdx = ordered.findIndex((f) => f.field_key === "sohyo");
  const body = bodyStart >= 0 ? ordered.slice(bodyStart, sohyoIdx >= 0 ? sohyoIdx : undefined) : [];

  const blocks: CommentBlock[] = [];
  let i = 0;
  let n = 1;
  while (i < body.length) {
    const field = body[i];
    const next = body[i + 1];
    if (next && next.field_key.startsWith(`${field.field_key}_`) && next.field_type === "text") {
      const suffix = next.field_label.includes("・") ? next.field_label.split("・").pop()! : next.field_label;
      blocks.push({ number: n, field, freeTextField: next, freeTextSuffix: suffix });
      i += 2;
    } else {
      blocks.push({ number: n, field, freeTextField: null, freeTextSuffix: null });
      i += 1;
    }
    n += 1;
  }
  return blocks;
}

export type CommentRowSlot = { block: CommentBlock; span: number } | "skip" | null;

// Lays each comment block across 2 tally rows (the last block absorbs whatever rows
// remain, so it still works if the tally/block counts ever change) — matches the
// reference sheet, where a comment box spans two 分類/確認項目/件数 rows regardless
// of whether those two rows belong to the same group.
export function buildCommentRowPlan(tallyRowCount: number, blocks: CommentBlock[]): CommentRowSlot[] {
  const plan: CommentRowSlot[] = new Array(tallyRowCount).fill(null);
  let cursor = 0;
  blocks.forEach((block, i) => {
    const rowsLeft = tallyRowCount - cursor;
    if (rowsLeft <= 0) return;
    const isLast = i === blocks.length - 1;
    const span = isLast ? rowsLeft : Math.min(2, rowsLeft);
    plan[cursor] = { block, span };
    for (let k = 1; k < span; k++) plan[cursor + k] = "skip";
    cursor += span;
  });
  return plan;
}

export function groupColClass(
  styles: Record<string, string>,
  group: string | undefined
): string {
  switch (group) {
    case "食事":
      return styles.colMeal;
    case "体調":
      return styles.colCondition;
    case "支援":
      return styles.colSupport;
    case "連絡":
      return styles.colContact;
    default:
      return styles.colMemo;
  }
}

export function tallyCategoryClass(styles: Record<string, string>, group: string): string {
  switch (group) {
    case "食事":
      return styles.tallyCategoryMeal;
    case "体調":
      return styles.tallyCategoryCondition;
    case "支援":
      return styles.tallyCategorySupport;
    case "連絡":
      return styles.tallyCategoryContact;
    default:
      return "";
  }
}
