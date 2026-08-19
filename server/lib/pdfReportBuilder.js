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
// tight one — 31 rows of daily data in landscape — so its columns are weighted
// by content type (checkbox columns just need room for a single ✓; 体調他/支援他/
// メモ need much more) instead of split evenly, which keeps free-text wrapping
// (and the row-height growth that comes with it) under control.
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
const PADDING_BORDER_OVERHEAD =
  TOTAL_COLS * CELL_PADDING_H * 2 + (TOTAL_COLS + 1) * BORDER_LINE_WIDTH;
const USABLE_WIDTH = PAGE_WIDTH_LANDSCAPE_A4 - PAGE_MARGIN_H * 2 - PADDING_BORDER_OVERHEAD;

// Monthly section (page 2) merges columns into generous 分類/確認項目/件数/コメント
// blocks regardless of per-column width, so an even split reads fine there.
const MONTHLY_COL_WIDTHS = new Array(TOTAL_COLS).fill(
  Math.floor((USABLE_WIDTH / TOTAL_COLS) * 100) / 100
);

// Daily grid (page 1): checkbox columns only ever hold a single ✓, so they're kept
// narrow; 配食者名/利用者確認印 are blank print columns that need a little room but
// no more; うけとり and the three free-text fields (体調他/支援他/メモ) get the extra
// width so real comments wrap onto 1-2 lines instead of 4-5 — that's what keeps 31
// rows of daily data inside one page's height.
const FIXED_COL_WEIGHTS = [0.5, 0.5, 1.1, 0.8, 1.6]; // 日, 曜, 配食者名, 利用者確認印, うけとり
const CHECKBOX_COL_WEIGHT = 0.55;
const TEXT_COL_WEIGHT = 2.2;

function computeDailyColWidths(orderedDailyBody) {
  const weights = [
    ...FIXED_COL_WEIGHTS,
    ...orderedDailyBody.map((f) => (f.field_type === "checkbox" ? CHECKBOX_COL_WEIGHT : TEXT_COL_WEIGHT)),
  ];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.floor(((w / totalWeight) * USABLE_WIDTH) * 100) / 100);
}

// The daily grid's free-text cells (受取's comment, 体調他/支援他/メモ) are the one
// thing that can make a day row grow arbitrarily tall — a long dictated note would
// wrap across many lines and, multiplied by up to 31 rows, blow past one page. Those
// cells are set noWrap below, so anything that doesn't fit its column is clipped by
// pdfmake with no visual cue; truncating with an ellipsis here instead keeps every
// row's height identical and tells the reader there's more, without touching the
// full text kept in the on-screen report / Excel export (neither has this constraint).
function truncateForWidth(text, widthPt, fontSize) {
  if (!text) return text;
  const maxChars = Math.max(1, Math.floor((widthPt - CELL_PADDING_H * 2) / (fontSize * 0.92)));
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return chars.slice(0, Math.max(1, maxChars - 1)).join("") + "…";
}

const hex = (rgb) => `#${rgb}`;

// Builds a 1-indexed (row, col) grid, mirroring the mergeAndStyle(ws, r1, c1, r2, c2, ...)
// calls in xlsxReportBuilder.js but targeting a plain array-of-arrays for pdfmake's
// table body instead of an ExcelJS worksheet.
function createGrid(cols) {
  const rows = [];
  const ensureRow = (r) => {
    while (rows.length < r) rows.push(new Array(cols).fill(null));
  };

  function cellNode(value, { bold, size, color, fill, align, wrap } = {}) {
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
        f.field_label !== PATIENT_SELECT_FIELD_LABEL
    )
    .sort((a, b) => a.order_index - b.order_index);

  const grid = createGrid(TOTAL_COLS);
  const { mergeAndStyle, setCell } = grid;
  let row = 1;

  // ---- Header block: 利用者名/記録月, 配送担当/食事内容, 利用回数/連絡方法, 報告先/先方担当者/記入者 ----
  const [y, m] = data.yearMonth.split("-");
  mergeAndStyle(row, 1, row, 2, "利用者名", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, 7, data.patient.name || "", { align: "left" });
  mergeAndStyle(row, 8, row, 9, "記録月", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 10, row, TOTAL_COLS, `${Number(y)}年　${Number(m)}月`, { align: "left" });
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
    TOTAL_COLS,
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
    TOTAL_COLS,
    mfByKey.renraku_hoho ? checklistText(mfByKey.renraku_hoho, monthlyValues.renraku_hoho) : "",
    { align: "left" }
  );
  row++;

  mergeAndStyle(row, 1, row, 2, "報告先", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, 5, textWithComment(monthlyValues.hokoku_saki), { align: "left" });
  mergeAndStyle(row, 6, row, 7, "先方担当者", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 8, row, 10, textWithComment(monthlyValues.senpo_tantosha), { align: "left" });
  mergeAndStyle(row, 11, row, 12, "記入者", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 13, row, TOTAL_COLS, textWithComment(monthlyValues.kinyusha), { align: "left" });
  row++;

  // ---- Daily grid ----
  const headerRow = row;
  // 配食者名/利用者確認印 are print-only columns for handwritten fill-in on the
  // printed sheet — not backed by a status_fields row, so they never appear in
  // the Status Input 対象フィールド picker.
  const headerCells = [
    "日",
    dfByKey.youbi?.field_label || "曜",
    "配食者名",
    "利用者確認印",
    dfByKey.uketori?.field_label || "受取",
  ];
  orderedDailyBody.forEach((f) => headerCells.push(f.field_label));
  headerCells.forEach((label, idx) => {
    setCell(headerRow, idx + 1, label, { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE, size: 7.5 });
  });
  row++;

  const dayRowByDate = new Map(data.days.map((d) => [d.record_date, d]));
  const photoDates = new Set(data.photoDates || []);
  const colWidths = computeDailyColWidths(orderedDailyBody);
  const DAY_ROW_FONT_SIZE = 7.5;
  for (let day = 1; day <= data.daysInMonth; day++) {
    const iso = `${data.yearMonth}-${String(day).padStart(2, "0")}`;
    const dayRow = dayRowByDate.get(iso);
    const values = dayRow?.values || {};
    const dateObj = new Date(`${iso}T00:00:00`);

    setCell(row, 1, day, { fill: COLORS.GRAY, size: DAY_ROW_FONT_SIZE });
    setCell(row, 2, rawValue(values.youbi) || WEEKDAY_JA[dateObj.getDay()], { fill: COLORS.GRAY, size: DAY_ROW_FONT_SIZE });
    setCell(row, 3, "", { fill: COLORS.GRAY, size: DAY_ROW_FONT_SIZE }); // 配食者名 — blank, filled in by hand
    // 利用者確認印 — ○ when a photo was uploaded for this day (写真を見る), else blank.
    setCell(row, 4, photoDates.has(iso) ? "○" : "", { fill: COLORS.GRAY, size: DAY_ROW_FONT_SIZE });
    // Every free-text cell below is noWrap + truncated to its own column width so a
    // long dictated note can never grow this row taller than its neighbors — see
    // truncateForWidth's comment for why that matters here.
    setCell(row, 5, truncateForWidth(textWithComment(values.uketori), colWidths[4], DAY_ROW_FONT_SIZE), {
      fill: COLORS.GRAY,
      size: DAY_ROW_FONT_SIZE,
      align: "left",
      wrap: false,
    });

    orderedDailyBody.forEach((f, idx) => {
      const fv = values[f.field_key];
      const isCheckbox = f.field_type === "checkbox";
      const value = isCheckbox
        ? isChecked(fv)
          ? "✓"
          : ""
        : truncateForWidth(textWithComment(fv), colWidths[5 + idx], DAY_ROW_FONT_SIZE);
      setCell(row, 6 + idx, value, {
        fill: FIELD_GROUP[f.field_key] ? GROUP_COLOR[FIELD_GROUP[f.field_key]] : COLORS.WHITE,
        size: DAY_ROW_FONT_SIZE,
        align: isCheckbox ? "center" : "left",
        wrap: isCheckbox ? undefined : false,
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
