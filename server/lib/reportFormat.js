// server/lib/reportFormat.js
// Shared data-shaping helpers for the 状況記録表兼報告書 export builders (xlsx + pdf).
// Colors are plain RRGGBB; each builder adapts them to its own color format.
const TOTAL_COLS = 19;

// UI-only helper field (switches the voice-input focus to the patient picker) — not
// part of the printed template, so exports drop it the same way the on-screen grid does.
const PATIENT_SELECT_FIELD_LABEL = "利用者選択";

const COLORS = {
  NAVY: "1F2D4A",
  ORANGE: "F2994A",
  GRAY: "E9E9E9",
  PEACH: "FBE0CF",
  BLUE: "D9ECF9",
  GREEN: "DDF0DD",
  PINK: "FBDCE4",
  YELLOW: "FCF1C7",
  WHITE: "FFFFFF",
};

// Column group -> fill color for the daily grid (mirrors reportController's TALLY_GROUPS,
// plus the two free-text columns that visually belong to the blue/green groups).
const GROUP_COLOR = {
  食事: COLORS.PEACH,
  体調: COLORS.BLUE,
  支援: COLORS.GREEN,
  連絡: COLORS.PINK,
};

const FIELD_GROUP = {
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

const TALLY_GROUPS = {
  食事: ["kanshoku", "hanbun", "nokoshi"],
  体調: ["shokuyoku_teika", "kaoiro_genki", "furatsuki"],
  支援: ["koekake", "shinbun_yubin", "genkan_anzen"],
  連絡: ["ihen_fuzai", "renraku_you"],
};

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
const CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨";

function isChecked(fieldValue) {
  if (fieldValue == null) return false;
  const v = typeof fieldValue === "object" ? fieldValue.value : fieldValue;
  return v === true || v === "✓" || v === "true";
}

function rawValue(fieldValue) {
  if (fieldValue == null) return "";
  return typeof fieldValue === "object" ? fieldValue.value ?? "" : fieldValue;
}

function rawComment(fieldValue) {
  if (fieldValue == null || typeof fieldValue !== "object") return "";
  return fieldValue.comment || "";
}

// Preset fields render as a checkbox list ("☑選択肢  ☐他の選択肢 ...") so a single
// cell shows every option plus which one was picked, same as the source sheet.
function checklistText(field, fieldValue) {
  const selected = rawValue(fieldValue);
  const options = field.phrases?.length ? field.phrases : [];
  if (!options.length) return String(selected || "");
  return options.map((opt) => `${opt === selected ? "☑" : "☐"}${opt}`).join("  ");
}

function textWithComment(fieldValue) {
  const v = rawValue(fieldValue);
  const c = rawComment(fieldValue);
  if (v === "" || v == null) return c ? `（${c}）` : "";
  return c ? `${v}（${c}）` : String(v);
}

// Pairs each preset field with the free-text field that follows it (…_hitokoto / …_naiyo)
// so numbered comment blocks (①総合評価, ②食事状況…) can be derived from field order
// instead of being hardcoded — stays correct if fields are edited later.
function buildCommentBlocks(monthlyFields) {
  const bodyStart = monthlyFields.findIndex((f) => f.field_key === "sogo_hyoka");
  const sohyoIdx = monthlyFields.findIndex((f) => f.field_key === "sohyo");
  const body = bodyStart >= 0 ? monthlyFields.slice(bodyStart, sohyoIdx >= 0 ? sohyoIdx : undefined) : [];

  const blocks = [];
  let i = 0;
  let n = 1;
  while (i < body.length) {
    const field = body[i];
    const next = body[i + 1];
    if (next && next.field_key.startsWith(`${field.field_key}_`) && next.field_type === "text") {
      const suffix = next.field_label.includes("・") ? next.field_label.split("・").pop() : next.field_label;
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

module.exports = {
  TOTAL_COLS,
  PATIENT_SELECT_FIELD_LABEL,
  COLORS,
  GROUP_COLOR,
  FIELD_GROUP,
  TALLY_GROUPS,
  WEEKDAY_JA,
  CIRCLED_NUMBERS,
  isChecked,
  rawValue,
  rawComment,
  checklistText,
  textWithComment,
  buildCommentBlocks,
};
