// server/lib/pdfReportBuilder.js
// Builds a printable PDF that mirrors the 状況記録表兼報告書 layout produced by
// xlsxReportBuilder.js: header block -> daily grid (color-coded by group) ->
// monthly tally table -> numbered report-comment blocks -> 総評 -> footer.
// Same underlying data/formatting helpers as the xlsx builder (see reportFormat.js);
// only the rendering target (pdfmake table vs. ExcelJS worksheet) differs.
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

const PAGE_MARGIN = 18;
const PAGE_WIDTH_LANDSCAPE_A4 = 841.89;
const CELL_PADDING_H = 3; // must match layout.paddingLeft/paddingRight below
const BORDER_LINE_WIDTH = 0.75; // must match layout.hLineWidth/vLineWidth below

// pdfmake adds cell padding + border width ON TOP of each declared column width
// (see docMeasure.js getOffsets) rather than carving it out of that width. Left
// unaccounted for, that overhead silently pushes the table wider than the page
// and clips the rightmost column(s) — so it has to be subtracted up front here.
const PADDING_BORDER_OVERHEAD =
  TOTAL_COLS * CELL_PADDING_H * 2 + (TOTAL_COLS + 1) * BORDER_LINE_WIDTH;
const USABLE_WIDTH = PAGE_WIDTH_LANDSCAPE_A4 - PAGE_MARGIN * 2 - PADDING_BORDER_OVERHEAD;
// All 17 columns share one equal width so the grid reads as a uniform table
// (rows with longer text — 受取/メモ comments — just wrap and grow taller).
const COL_WIDTHS = new Array(TOTAL_COLS).fill(Math.floor((USABLE_WIDTH / TOTAL_COLS) * 100) / 100);

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
    const node = {
      text: withSymbolFont(value === undefined || value === null ? "" : String(value)),
      bold: !!bold,
      fontSize: size || 9,
      color: hex(color || "1A1A1A"),
      alignment: align || "center",
      margin: [3, 2, 3, 2],
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

function buildReportPdfDocDefinition({ data, dailyFields, monthlyFields }) {
  const grid = createGrid(TOTAL_COLS);
  const monthlyValues = data.monthlyReport || {};
  const mfByKey = Object.fromEntries(monthlyFields.map((f) => [f.field_key, f]));
  const dfByKey = Object.fromEntries(dailyFields.map((f) => [f.field_key, f]));
  const orderedDailyBody = dailyFields
    .filter(
      (f) =>
        f.field_key !== "youbi" &&
        f.field_key !== "uketori" &&
        f.field_label !== PATIENT_SELECT_FIELD_LABEL
    )
    .sort((a, b) => a.order_index - b.order_index);

  let row = 1;
  const { mergeAndStyle, setCell } = grid;

  // ---- Header block: 利用者名/記録月, 配送担当/食事内容, 利用回数/連絡方法, 報告先/先方担当者/記入者 ----
  const [y, m] = data.yearMonth.split("-");
  mergeAndStyle(row, 1, row, 2, "利用者名", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, 7, data.patient.name || "", { align: "left" });
  mergeAndStyle(row, 8, row, 9, "記録月", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 10, row, 17, `${Number(y)}年　${Number(m)}月`, { align: "left" });
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
    17,
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
    17,
    mfByKey.renraku_hoho ? checklistText(mfByKey.renraku_hoho, monthlyValues.renraku_hoho) : "",
    { align: "left" }
  );
  row++;

  mergeAndStyle(row, 1, row, 2, "報告先", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 3, row, 5, textWithComment(monthlyValues.hokoku_saki), { align: "left" });
  mergeAndStyle(row, 6, row, 7, "先方担当者", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 8, row, 10, textWithComment(monthlyValues.senpo_tantosha), { align: "left" });
  mergeAndStyle(row, 11, row, 12, "記入者", { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE });
  mergeAndStyle(row, 13, row, 17, textWithComment(monthlyValues.kinyusha), { align: "left" });
  row++;

  row++; // spacer

  // ---- Daily grid ----
  const headerRow = row;
  const headerCells = ["日", dfByKey.youbi?.field_label || "曜", dfByKey.uketori?.field_label || "受取"];
  orderedDailyBody.forEach((f) => headerCells.push(f.field_label));
  headerCells.forEach((label, idx) => {
    setCell(headerRow, idx + 1, label, { bold: true, fill: COLORS.NAVY, color: COLORS.WHITE, size: 8 });
  });
  row++;

  const dayRowByDate = new Map(data.days.map((d) => [d.record_date, d]));
  for (let day = 1; day <= data.daysInMonth; day++) {
    const iso = `${data.yearMonth}-${String(day).padStart(2, "0")}`;
    const dayRow = dayRowByDate.get(iso);
    const values = dayRow?.values || {};
    const dateObj = new Date(`${iso}T00:00:00`);

    setCell(row, 1, day, { fill: COLORS.GRAY, size: 8 });
    setCell(row, 2, rawValue(values.youbi) || WEEKDAY_JA[dateObj.getDay()], { fill: COLORS.GRAY, size: 8 });
    setCell(row, 3, textWithComment(values.uketori), { fill: COLORS.GRAY, size: 8, align: "left" });

    orderedDailyBody.forEach((f, idx) => {
      const fv = values[f.field_key];
      const value = f.field_type === "checkbox" ? (isChecked(fv) ? "✓" : "") : textWithComment(fv);
      setCell(row, 4 + idx, value, {
        fill: FIELD_GROUP[f.field_key] ? GROUP_COLOR[FIELD_GROUP[f.field_key]] : COLORS.WHITE,
        size: 8,
        align: f.field_type === "checkbox" ? "center" : "left",
      });
    });
    row++;
  }

  row++; // spacer

  // ---- 月次報告欄 (tally table + numbered comment blocks) ----
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

  const body = grid.finalize();

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN],
    defaultStyle: { font: "NotoSansJP", fontSize: 9 },
    content: [
      {
        table: { widths: COL_WIDTHS, body, dontBreakRows: true },
        layout: {
          hLineWidth: () => BORDER_LINE_WIDTH,
          vLineWidth: () => BORDER_LINE_WIDTH,
          hLineColor: () => "#B9B9B9",
          vLineColor: () => "#B9B9B9",
          paddingLeft: () => CELL_PADDING_H,
          paddingRight: () => CELL_PADDING_H,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
      },
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
