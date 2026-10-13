// server/lib/pdfReportBuilder.js
// Builds a printable PDF that mirrors the 状況記録表兼報告書 layout produced by
// xlsxReportBuilder.js: header block -> daily grid (color-coded by group) ->
// monthly tally table -> numbered report-comment blocks -> 総評 -> footer.
// Same underlying data/formatting helpers as the xlsx builder (see reportFormat.js);
// only the rendering target (pdfmake table vs. ExcelJS worksheet) differs.
//
// Fixed to exactly 2 pages: the daily grid (header block + up to 31 day rows) is
// forced onto page 1 and the monthly report section onto page 2 via two separate
// table nodes (pdfmake auto-paginates a single table wherever it runs out of
// room, so one continuous table can't be pinned to a page count). Page 1 is the
// tight one — 31 rows of daily data in landscape — so every cell on it is kept to
// a single line (no wrapping): each column is sized to fit its header on one line,
// leftover width goes to the free-text/comment columns, and longer values are
// cut off with "…" at the column edge.
const path = require("path");
const PdfPrinter = require("pdfmake");
const {
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
} = require("./reportFormat");

const FONT_DIR = path.join(__dirname, "..", "fonts");
const FONTS = {
  NotoSansJP: {
    normal: path.join(FONT_DIR, "NotoSansJP-Regular.otf"),
    bold: path.join(FONT_DIR, "NotoSansJP-Bold.otf"),
    italics: path.join(FONT_DIR, "NotoSansJP-Regular.otf"),
    bolditalics: path.join(FONT_DIR, "NotoSansJP-Bold.otf"),
  },
  // Noto Sans JP has no glyphs for ☑/☐ (Misc Symbols block); this font covers them.
  Symbols: {
    normal: path.join(FONT_DIR, "NotoSansSymbols2-Regular.ttf"),
    bold: path.join(FONT_DIR, "NotoSansSymbols2-Regular.ttf"),
    italics: path.join(FONT_DIR, "NotoSansSymbols2-Regular.ttf"),
    bolditalics: path.join(FONT_DIR, "NotoSansSymbols2-Regular.ttf"),
  },
};

// checklistText() renders options as "☑選択肢  ☐他の選択肢"; ☑/☐ need the Symbols
// font, so split them into their own inline spans within the cell's text array.
const SYMBOL_CHAR_RE = /[☐☑]/;
function withSymbolFont(text) {
  if (!text || !SYMBOL_CHAR_RE.test(text)) return text;
  const spans = [];
  let buf = "";
  for (const ch of text) {
    if (SYMBOL_CHAR_RE.test(ch)) {
      if (buf) spans.push({ text: buf });
      spans.push({ text: ch, font: "Symbols" });
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf) spans.push({ text: buf });
  return spans;
}

const PAGE_MARGIN_H = 16;
const PAGE_MARGIN_V = 14;
const PAGE_WIDTH_LANDSCAPE_A4 = 841.89;
const CELL_PADDING_H = 2.5; // must match layout.paddingLeft/paddingRight below
const CELL_PADDING_V = 1; // must match layout.paddingTop/paddingBottom below
const BORDER_LINE_WIDTH = 0.75; // must match layout.hLineWidth/vLineWidth below

// pdfmake adds cell padding + border width ON TOP of each declared column width
// (see docMeasure.js getOffsets) rather than carving it out of that width. Left
// unaccounted for, that overhead silently pushes the table wider than the page
// and clips the rightmost column(s) — so it has to be subtracted up front here.
function usableWidth(cols) {
  const overhead = cols * CELL_PADDING_H * 2 + (cols + 1) * BORDER_LINE_WIDTH;
  return PAGE_WIDTH_LANDSCAPE_A4 - PAGE_MARGIN_H * 2 - overhead;
}
const USABLE_WIDTH = usableWidth(TOTAL_COLS);

// Monthly section (page 2) merges columns into generous 分類/確認項目/件数/コメント
// blocks regardless of per-column width, so an even split reads fine there.
const MONTHLY_COL_WIDTHS = new Array(TOTAL_COLS).fill(
  Math.floor((USABLE_WIDTH / TOTAL_COLS) * 100) / 100
);

// Daily grid (page 1). Comment columns sit right after the column they belong
// to, as in the on-screen report: うけとり's after うけとり, and the 食べ残し/体調
// group comments (stored on the group's anchor field) after the group's last column.
const GROUP_COMMENT_COLUMNS = [
  { group: "食事", commentKey: "kanshoku", label: "食べ残しコメント" },
  { group: "体調", commentKey: "shokuyoku_teika", label: "体調コメント" },
];
const DAILY_HEADER_FONT_SIZE = 7.5;
const DAY_ROW_FONT_SIZE = 7.5;
// Minimum content widths, in ems of the row font, for columns whose values can be
// longer than their header (names, free text, comments) — on top of the header fit.
// 日/曜 ("day") are wider than their one-character headers need because the header
// block's 利用者名/配送担当/利用回数/報告先 labels sit across those two columns.
const MIN_EMS = { day: 2.4, delivery: 6.5, uketori: 3, text: 4, comment: 7 };

// Rough one-line width of `text` in ems: full-width (CJK) characters take ~1em,
// ASCII/half-width ones ~0.55em. Used to size each column so its header fits.
function textEms(text) {
  let ems = 0;
  for (const ch of String(text || "")) ems += ch.charCodeAt(0) < 0x2000 ? 0.55 : 1;
  return ems;
}

// Builds the daily grid's column list (header label + kind per column).
function buildDailyColumns(dfByKey, orderedDailyBody) {
  const uketoriLabel = dfByKey.uketori?.field_label || "受取";
  const cols = [
    { label: "日", kind: "day" },
    { label: dfByKey.youbi?.field_label || "曜", kind: "day" },
    { label: "配食者名", kind: "delivery" },
    { label: "利用者確認印", kind: "fixed" },
    { label: uketoriLabel, kind: "uketori" },
    { label: `${uketoriLabel}コメント`, kind: "comment", commentKey: "uketori", fill: COLORS.GRAY },
  ];
  const lastOfGroup = new Map();
  orderedDailyBody.forEach((f) => {
    if (FIELD_GROUP[f.field_key]) lastOfGroup.set(FIELD_GROUP[f.field_key], f.field_key);
  });
  orderedDailyBody.forEach((f) => {
    cols.push({ label: f.field_label, kind: f.field_type === "checkbox" ? "checkbox" : "text", field: f });
    const gc = GROUP_COMMENT_COLUMNS.find((g) => lastOfGroup.get(g.group) === f.field_key);
    if (gc) cols.push({ label: gc.label, kind: "comment", commentKey: gc.commentKey, fill: GROUP_COLOR[gc.group] });
  });
  return cols;
}

// Each column gets at least the width its header needs on one line (plus a
// per-kind minimum for longer values); leftover page width goes to the text and
// comment columns. If even the minimums don't fit, everything scales down evenly.
function computeDailyColWidths(columns) {
  const avail = usableWidth(columns.length);
  const mins = columns.map((c) => {
    const headerPt = textEms(c.label) * DAILY_HEADER_FONT_SIZE + 1;
    const valuePt = (MIN_EMS[c.kind] || 1.2) * DAY_ROW_FONT_SIZE;
    return Math.max(headerPt, valuePt);
  });
  const minTotal = mins.reduce((a, b) => a + b, 0);
  if (minTotal >= avail) return mins.map((w) => Math.floor(((w / minTotal) * avail) * 100) / 100);
  const growIdx = columns
    .map((c, i) => (c.kind === "text" || c.kind === "comment" || c.kind === "uketori" ? i : -1))
    .filter((i) => i >= 0);
  const extra = (avail - minTotal) / (growIdx.length || columns.length);
  return mins.map(
    (w, i) => Math.floor((w + (growIdx.length === 0 || growIdx.includes(i) ? extra : 0)) * 100) / 100
  );
}

// The daily grid's free-text cells (受取's comment, 体調他/支援他/メモ) are the one
// thing that can make a day row grow arbitrarily tall — a long dictated note would
// wrap across many lines and, multiplied by up to 31 rows, blow past one page. Those
// cells are set noWrap below, so anything that doesn't fit its column is clipped by
// pdfmake with no visual cue; truncating with an ellipsis here instead keeps every
// row's height identical and tells the reader there's more, without touching the
// full text kept in the on-screen report / Excel export (neither has this constraint).
// Measured per character (full-width ~1em, half-width ~0.55em — see textEms) so
// Latin text isn't cut far shorter than the column actually allows.
function truncateForWidth(text, widthPt, fontSize) {
  if (!text) return text;
  const maxEms = Math.max(1, (widthPt - CELL_PADDING_H * 2) / (fontSize * 0.98));
  if (textEms(text) <= maxEms) return text;
  let out = "";
  let used = 1; // room for the "…"
  for (const ch of Array.from(text)) {
    const w = textEms(ch);
    if (used + w > maxEms) break;
    out += ch;
    used += w;
  }
  return (out || Array.from(text)[0]) + "…";
}

const hex = (rgb) => `#${rgb}`;

// Builds a 1-indexed (row, col) grid, mirroring the mergeAndStyle(ws, r1, c1, r2, c2, ...)
// calls in xlsxReportBuilder.js but targeting a plain array-of-arrays for pdfmake's
// table body instead of an ExcelJS worksheet.
// `defaultWrap: false` makes every cell single-line (noWrap) unless it opts back in.
function createGrid(cols, { defaultWrap } = {}) {
  const rows = [];
  const ensureRow = (r) => {
    while (rows.length < r) rows.push(new Array(cols).fill(null));
  };

  function cellNode(value, { bold, size, color, fill, align, wrap = defaultWrap } = {}) {
    // No per-node `margin` here — the table layout's paddingTop/Bottom/Left/Right
    // (below) already spaces cell content from its border; stacking a node margin
    // on top of that would double the per-row vertical overhead across 30+ rows.
    const node = {
      text: withSymbolFont(value === undefined || value === null ? "" : String(value)),
      bold: !!bold,
      fontSize: size || 8,
      color: hex(color || "1A1A1A"),
      alignment: align || "center",
    };
    if (fill) node.fillColor = hex(fill);
    if (wrap === false) node.noWrap = true;
    return node;
  }

  function mergeAndStyle(r1, c1, r2, c2, value, opts) {
    ensureRow(r2);
    const node = cellNode(value, opts);
    node.colSpan = c2 - c1 + 1;
    node.rowSpan = r2 - r1 + 1;
    rows[r1 - 1][c1 - 1] = node;
    for (let rr = r1; rr <= r2; rr++) {
      for (let cc = c1; cc <= c2; cc++) {
        if (rr === r1 && cc === c1) continue;
        rows[rr - 1][cc - 1] = { text: "", border: [false, false, false, false] };
      }
    }
    return node;
  }

  function setCell(r, c, value, opts) {
    return mergeAndStyle(r, c, r, c, value, opts);
  }

  function finalize() {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols; c++) {
        if (rows[r][c] == null) rows[r][c] = { text: "", border: [false, false, false, false] };
      }
    }
    return rows;
  }

  return { mergeAndStyle, setCell, finalize };
}

const TABLE_LAYOUT = {
  hLineWidth: () => BORDER_LINE_WIDTH,
  vLineWidth: () => BORDER_LINE_WIDTH,
  hLineColor: () => "#B9B9B9",
  vLineColor: () => "#B9B9B9",
  paddingLeft: () => CELL_PADDING_H,
  paddingRight: () => CELL_PADDING_H,
  paddingTop: () => CELL_PADDING_V,
  paddingBottom: () => CELL_PADDING_V,
};

// ---- Page 1: header block + daily grid ----
function buildDailyGridTable({ data, dailyFields, monthlyFields }) {
  const dfByKey = Object.fromEntries(dailyFields.map((f) => [f.field_key, f]));
  const mfByKey = Object.fromEntries(monthlyFields.map((f) => [f.field_key, f]));
  const monthlyValues = data.monthlyReport || {};
  const orderedDailyBody = dailyFields
    .filter(
      (f) =>
        f.field_key !== "youbi" &&
        f.field_key !== "uketori" &&
        // メモ isn't shown in the report grid (its data stays in the record).
        f.field_key !== "memo" &&
        f.field_label !== PATIENT_SELECT_FIELD_LABEL
    )
    .sort((a, b) => a.order_index - b.order_index);

  const columns = buildDailyColumns(dfByKey, orderedDailyBody);
  const DAILY_COLS = columns.length;
  const colWidths = computeDailyColWidths(columns);
  // Every cell on page 1 stays on one line (see the header comment).
  const grid = createGrid(DAILY_COLS, { defaultWrap: false });
  const { mergeAndStyle, setCell } = grid;
  let row = 1;

  // ---- Header block: 利用者名/記録月, 配送担当/食事内容, 利用回数/連絡方法, 報告先/先方担当者/記入者 ----
  const [y, m] = data.yearMonth.split("-");
  mergeAndStyle(row, 1, row, 2, "利用者名", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, 7, data.patient.name || "", { align: "left" });
  mergeAndStyle(row, 8, row, 9, "記録月", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 10, row, DAILY_COLS, `${Number(y)}年　${Number(m)}月`, { align: "left" });
  row++;

  mergeAndStyle(row, 1, row, 2, "配送担当", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(
    row,
    3,
    row,
    7,
    mfByKey.hasso_tanto ? checklistText(mfByKey.hasso_tanto, monthlyValues.hasso_tanto) : "",
    { align: "left" }
  );
  mergeAndStyle(row, 8, row, 9, "食事内容", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(
    row,
    10,
    row,
    DAILY_COLS,
    mfByKey.shokuji_naiyo ? checklistText(mfByKey.shokuji_naiyo, monthlyValues.shokuji_naiyo) : "",
    { align: "left" }
  );
  row++;

  mergeAndStyle(row, 1, row, 2, "利用回数", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, 7, textWithComment(monthlyValues.riyo_kaisu), { align: "left" });
  mergeAndStyle(row, 8, row, 9, "連絡方法", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(
    row,
    10,
    row,
    DAILY_COLS,
    mfByKey.renraku_hoho ? checklistText(mfByKey.renraku_hoho, monthlyValues.renraku_hoho) : "",
    { align: "left" }
  );
  row++;

  mergeAndStyle(row, 1, row, 2, "報告先", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, 5, textWithComment(monthlyValues.hokoku_saki), { align: "left" });
  mergeAndStyle(row, 6, row, 7, "先方担当者", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 8, row, 10, textWithComment(monthlyValues.senpo_tantosha), { align: "left" });
  mergeAndStyle(row, 11, row, 12, "記入者", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 13, row, DAILY_COLS, textWithComment(monthlyValues.kinyusha), { align: "left" });
  row++;

  // ---- Daily grid ----
  const headerRow = row;
  // 配食者名/利用者確認印 are print-only columns for handwritten fill-in on the
  // printed sheet — not backed by a status_fields row, so they never appear in
  // the Status Input 対象フィールド picker.
  columns.forEach((c, idx) => {
    setCell(headerRow, idx + 1, c.label, {
      bold: true,
      fill: COLORS.NAVY,
      color: COLORS.WHITE,
      size: DAILY_HEADER_FONT_SIZE,
    });
  });
  row++;

  const dayRowByDate = new Map(data.days.map((d) => [d.record_date, d]));
  const photoDates = new Set(data.photoDates || []);
  for (let day = 1; day <= data.daysInMonth; day++) {
    const iso = `${data.yearMonth}-${String(day).padStart(2, "0")}`;
    const dayRow = dayRowByDate.get(iso);
    const values = dayRow?.values || {};
    const dateObj = new Date(`${iso}T00:00:00`);

    setCell(row, 1, day, { fill: COLORS.GRAY, size: DAY_ROW_FONT_SIZE });
    setCell(row, 2, rawValue(values.youbi) || WEEKDAY_JA[dateObj.getDay()], { fill: COLORS.GRAY, size: DAY_ROW_FONT_SIZE });
    // 配食者名 — logged-in user stamped at save time (see StatusMatcher's handleSaveRecord).
    setCell(row, 3, truncateForWidth(String(rawValue(values.delivery_person) || ""), colWidths[2], DAY_ROW_FONT_SIZE), {
      fill: COLORS.GRAY,
      size: DAY_ROW_FONT_SIZE,
    });
    // 利用者確認印 — ○ when a photo was uploaded for this day (写真を見る), else blank.
    setCell(row, 4, photoDates.has(iso) ? "○" : "", { fill: COLORS.GRAY, size: DAY_ROW_FONT_SIZE });
    // Every free-text cell below is noWrap + truncated to its own column width so a
    // long dictated note can never grow this row taller than its neighbors — see
    // truncateForWidth's comment for why that matters here.
    setCell(row, 5, truncateForWidth(String(rawValue(values.uketori) || ""), colWidths[4], DAY_ROW_FONT_SIZE), {
      fill: COLORS.GRAY,
      size: DAY_ROW_FONT_SIZE,
      align: "left",
    });

    // Columns 6+ (うけとりコメント, then the daily fields with their group comment
    // columns) follow the `columns` list built above.
    columns.slice(5).forEach((c, i) => {
      const col = 6 + i;
      const width = colWidths[col - 1];
      if (c.kind === "comment") {
        setCell(row, col, truncateForWidth(rawComment(values[c.commentKey]), width, DAY_ROW_FONT_SIZE), {
          fill: c.fill,
          size: DAY_ROW_FONT_SIZE,
          align: "left",
        });
        return;
      }
      const f = c.field;
      const fv = values[f.field_key];
      const isCheckbox = c.kind === "checkbox";
      const value = isCheckbox
        ? isChecked(fv)
          ? "✓"
          : ""
        : truncateForWidth(textWithComment(fv), width, DAY_ROW_FONT_SIZE);
      setCell(row, col, value, {
        fill: FIELD_GROUP[f.field_key] ? GROUP_COLOR[FIELD_GROUP[f.field_key]] : COLORS.WHITE,
        size: DAY_ROW_FONT_SIZE,
        align: isCheckbox ? "center" : "left",
      });
    });
    row++;
  }

  return {
    table: { widths: colWidths, body: grid.finalize(), dontBreakRows: true },
    layout: TABLE_LAYOUT,
  };
}

// ---- Page 2: monthly tally table + numbered comment blocks + 総評 + footer ----
function buildMonthlySectionTable({ data, dailyFields, monthlyFields }) {
  const dfByKey = Object.fromEntries(dailyFields.map((f) => [f.field_key, f]));
  const mfByKey = Object.fromEntries(monthlyFields.map((f) => [f.field_key, f]));
  const monthlyValues = data.monthlyReport || {};

  const grid = createGrid(TOTAL_COLS);
  const { mergeAndStyle, setCell } = grid;
  let row = 1;

  mergeAndStyle(row, 1, row, TOTAL_COLS, "月次報告欄", { bold: true, size: 12, fill: COLORS.ORANGE, color: COLORS.WHITE });
  row++;

  mergeAndStyle(row, 1, row, 2, "分類", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, 6, "確認項目", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 7, row, 8, "件数", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  setCell(row, 9, "", { fill: COLORS.NAVY });
  mergeAndStyle(row, 10, row, TOTAL_COLS, "報告書コメント欄｜該当するものに✓＋必要時のみ一言", {
    bold: true,
    fill: COLORS.NAVY,
    color: COLORS.WHITE,
    size: 8,
  });
  row++;

  const tallyStartRow = row;
  const commentBlocks = buildCommentBlocks(monthlyFields);
  const tallyRowKeys = Object.entries(TALLY_GROUPS).flatMap(([group, keys]) => keys.map((k) => [group, k]));

  tallyRowKeys.forEach(([group, key], idx) => {
    const r = tallyStartRow + idx;
    const label = dfByKey[key]?.field_label || key;
    const count = data.tallies?.[group]?.[key] ?? 0;

    mergeAndStyle(r, 1, r, 2, group, { fill: GROUP_COLOR[group], bold: true, size: 9 });
    mergeAndStyle(r, 3, r, 6, label, { fill: COLORS.WHITE, align: "left", size: 9 });
    mergeAndStyle(r, 7, r, 8, count, { fill: COLORS.YELLOW, bold: true, size: 9 });
  });

  // Each comment block spans 2 tally rows (the last block absorbs whatever rows
  // remain), matching the reference sheet's boxes — regardless of whether the two
  // rows it covers belong to the same 分類 group.
  let cursor = 0;
  commentBlocks.forEach((block, i) => {
    const rowsLeft = tallyRowKeys.length - cursor;
    if (rowsLeft <= 0) return;
    const isLast = i === commentBlocks.length - 1;
    const span = isLast ? rowsLeft : Math.min(2, rowsLeft);
    const r1 = tallyStartRow + cursor;
    const r2 = r1 + span - 1;

    const optionsLine = checklistText(block.field, monthlyValues[block.field.field_key]);
    const freeText = block.freeTextField ? textWithComment(monthlyValues[block.freeTextField.field_key]) : "";
    const numeral = CIRCLED_NUMBERS[block.number - 1] || `${block.number}.`;
    const lines = [`${numeral}${block.field.field_label}`, optionsLine];
    if (block.freeTextSuffix) lines.push(`${block.freeTextSuffix}：${freeText}`);

    mergeAndStyle(r1, 9, r2, TOTAL_COLS, lines.filter(Boolean).join("\n"), { align: "left", size: 9 });

    cursor += span;
  });
  row = tallyStartRow + tallyRowKeys.length;

  row++; // spacer

  // ---- 総評 ----
  mergeAndStyle(row, 1, row, 2, "総評", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, TOTAL_COLS, textWithComment(monthlyValues.sohyo), { align: "left" });
  row++;

  row++; // spacer

  // ---- Footer: 報告日 / 確認者 / 家族・関係機関共有 ----
  mergeAndStyle(row, 1, row, 2, "報告日", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, 6, textWithComment(monthlyValues.hokokubi), { align: "left" });
  mergeAndStyle(row, 7, row, 8, "確認者", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 9, row, 11, textWithComment(monthlyValues.kakuninsha), { align: "left" });
  mergeAndStyle(row, 12, row, 14, "家族・関係機関共有", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE, size: 8 });
  mergeAndStyle(
    row,
    15,
    row,
    TOTAL_COLS,
    mfByKey.kyoyu_status ? checklistText(mfByKey.kyoyu_status, monthlyValues.kyoyu_status) : "",
    { align: "left", size: 8 }
  );

  return {
    table: { widths: MONTHLY_COL_WIDTHS, body: grid.finalize(), dontBreakRows: true },
    layout: TABLE_LAYOUT,
    pageBreak: "before",
  };
}

function buildReportPdfDocDefinition({ data, dailyFields, monthlyFields }) {
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [PAGE_MARGIN_H, PAGE_MARGIN_V, PAGE_MARGIN_H, PAGE_MARGIN_V],
    defaultStyle: { font: "NotoSansJP", fontSize: 8 },
    content: [
      buildDailyGridTable({ data, dailyFields, monthlyFields }),
      buildMonthlySectionTable({ data, dailyFields, monthlyFields }),
    ],
  };
}

async function buildReportPdfBuffer({ data, dailyFields, monthlyFields }) {
  const printer = new PdfPrinter(FONTS);
  const docDefinition = buildReportPdfDocDefinition({ data, dailyFields, monthlyFields });
  const doc = printer.createPdfKitDocument(docDefinition);

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

module.exports = { buildReportPdfBuffer };
