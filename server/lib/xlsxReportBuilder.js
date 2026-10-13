// server/lib/xlsxReportBuilder.js
// Builds a printable .xlsx that mirrors the 状況記録表兼報告書 layout:
// header block -> daily grid (color-coded by group) -> monthly tally table ->
// numbered report-comment blocks -> 総評 -> footer.
const ExcelJS = require("exceljs");
const {
  PATIENT_SELECT_FIELD_LABEL,
  COLORS,
  GROUP_COLOR: GROUP_COLOR_RGB,
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

// ExcelJS wants ARGB; reportFormat's shared palette is plain RRGGBB.
const argb = (rgb) => `FF${rgb}`;
const NAVY = argb(COLORS.NAVY);
const ORANGE = argb(COLORS.ORANGE);
const GRAY = argb(COLORS.GRAY);
const YELLOW = argb(COLORS.YELLOW);
const WHITE = argb(COLORS.WHITE);
const GROUP_COLOR = Object.fromEntries(Object.entries(GROUP_COLOR_RGB).map(([k, v]) => [k, argb(v)]));

function styleCell(cell, { bold, size, color, fill, align, valign, wrap, border } = {}) {
  cell.font = { name: "Yu Gothic", size: size || 10, bold: !!bold, color: { argb: color || "FF1A1A1A" } };
  if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.alignment = {
    horizontal: align || "center",
    vertical: valign || "middle",
    wrapText: wrap !== false,
  };
  if (border !== false) {
    const thin = { style: "thin", color: { argb: "FFB9B9B9" } };
    cell.border = { top: thin, left: thin, bottom: thin, right: thin };
  }
}

// Daily grid comment columns sit right after the column they belong to, as in the
// on-screen report: うけとり's after うけとり, and the 食べ残し/体調 group comments
// (stored on the group's anchor field) after the group's last column.
const GROUP_COMMENT_COLUMNS = [
  { group: "食事", commentKey: "kanshoku", label: "食べ残しコメント" },
  { group: "体調", commentKey: "shokuyoku_teika", label: "体調コメント" },
];

// Rough one-line width of `text` in ems: full-width (CJK) characters ~1em,
// ASCII/half-width ones ~0.55em.
function textEms(text) {
  let ems = 0;
  for (const ch of String(text || "")) ems += ch.charCodeAt(0) < 0x2000 ? 0.55 : 1;
  return ems;
}

// Minimum column widths (Excel width units) for columns whose values can be longer
// than their header. 日/曜 are wider than their one-character headers need because
// the 利用者名/配送担当/利用回数/報告先/分類 labels are merged across those two columns.
const MIN_COL_WIDTH = { day: 4.8, delivery: 10, uketori: 7, text: 9, comment: 13, checkbox: 4.5, fixed: 4.5 };
const HEADER_FONT_SIZE = 9;

// Builds the daily grid's column list (header label + kind per column).
function buildDailyColumns(dfByKey, orderedDailyBody) {
  const uketoriLabel = dfByKey.uketori?.field_label || "受取";
  const cols = [
    { label: "日", kind: "day" },
    { label: dfByKey.youbi?.field_label || "曜", kind: "day" },
    { label: "配食者名", kind: "delivery" },
    { label: "利用者確認印", kind: "fixed" },
    { label: uketoriLabel, kind: "uketori" },
    { label: `${uketoriLabel}コメント`, kind: "comment", commentKey: "uketori", fill: GRAY },
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

// Width that fits the column's header on one line (a full-width character at the
// header's 9pt is ~1.8 width units), or the per-kind minimum, whichever is larger.
function columnWidth(col) {
  const headerFit = textEms(col.label) * 1.8 + 1.2;
  let w = Math.max(headerFit, MIN_COL_WIDTH[col.kind] || 4.5);
  w = Math.round(w * 10) / 10;
  // ExcelJS treats width===9 as its internal "unset" default and silently drops
  // such columns from the file, so avoid that exact value.
  return w === 9 ? 9.1 : w;
}

function mergeAndStyle(ws, r1, c1, r2, c2, value, opts) {
  ws.mergeCells(r1, c1, r2, c2);
  const cell = ws.getCell(r1, c1);
  cell.value = value;
  styleCell(cell, opts);
  return cell;
}

async function buildReportWorkbook({ data, dailyFields, monthlyFields }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "patient-status-report";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("報告書", {
    pageSetup: {
      orientation: "landscape",
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    views: [{ showGridLines: false }],
  });

  const monthlyValues = data.monthlyReport || {};
  const mfByKey = Object.fromEntries(monthlyFields.map((f) => [f.field_key, f]));
  const dfByKey = Object.fromEntries(dailyFields.map((f) => [f.field_key, f]));
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

  // The daily grid's columns set the sheet's column count and widths. Each column
  // is sized so its header fits on one line; the header block and daily grid are
  // single-line (no wrapping) throughout. The monthly section below reuses the
  // same columns and spans the full width.
  const columns = buildDailyColumns(dfByKey, orderedDailyBody);
  const COLS = columns.length;
  columns.forEach((c, idx) => {
    ws.getColumn(idx + 1).width = columnWidth(c);
  });

  let row = 1;

  // ---- Header block: 利用者名/記録月, 配送担当/食事内容, 利用回数/連絡方法, 報告先/先方担当者/記入者 ----
  const [y, m] = data.yearMonth.split("-");
  mergeAndStyle(ws, row, 1, row, 2, "利用者名", { bold: true, fill: NAVY, color: WHITE, wrap: false });
  mergeAndStyle(ws, row, 3, row, 7, data.patient.name || "", { align: "left", wrap: false });
  mergeAndStyle(ws, row, 8, row, 9, "記録月", { bold: true, fill: NAVY, color: WHITE, wrap: false });
  mergeAndStyle(ws, row, 10, row, COLS, `${Number(y)}年　${Number(m)}月`, { align: "left", wrap: false });
  row++;

  mergeAndStyle(ws, row, 1, row, 2, "配送担当", { bold: true, fill: NAVY, color: WHITE, wrap: false });
  mergeAndStyle(
    ws,
    row,
    3,
    row,
    7,
    mfByKey.hasso_tanto ? checklistText(mfByKey.hasso_tanto, monthlyValues.hasso_tanto) : "",
    { align: "left", wrap: false }
  );
  mergeAndStyle(ws, row, 8, row, 9, "食事内容", { bold: true, fill: NAVY, color: WHITE, wrap: false });
  mergeAndStyle(
    ws,
    row,
    10,
    row,
    COLS,
    mfByKey.shokuji_naiyo ? checklistText(mfByKey.shokuji_naiyo, monthlyValues.shokuji_naiyo) : "",
    { align: "left", wrap: false }
  );
  row++;

  mergeAndStyle(ws, row, 1, row, 2, "利用回数", { bold: true, fill: NAVY, color: WHITE, wrap: false });
  mergeAndStyle(ws, row, 3, row, 7, textWithComment(monthlyValues.riyo_kaisu), { align: "left", wrap: false });
  mergeAndStyle(ws, row, 8, row, 9, "連絡方法", { bold: true, fill: NAVY, color: WHITE, wrap: false });
  mergeAndStyle(
    ws,
    row,
    10,
    row,
    COLS,
    mfByKey.renraku_hoho ? checklistText(mfByKey.renraku_hoho, monthlyValues.renraku_hoho) : "",
    { align: "left", wrap: false }
  );
  row++;

  mergeAndStyle(ws, row, 1, row, 2, "報告先", { bold: true, fill: NAVY, color: WHITE, wrap: false });
  mergeAndStyle(ws, row, 3, row, 5, textWithComment(monthlyValues.hokoku_saki), { align: "left", wrap: false });
  mergeAndStyle(ws, row, 6, row, 7, "先方担当者", { bold: true, fill: NAVY, color: WHITE, wrap: false });
  mergeAndStyle(ws, row, 8, row, 10, textWithComment(monthlyValues.senpo_tantosha), { align: "left", wrap: false });
  mergeAndStyle(ws, row, 11, row, 12, "記入者", { bold: true, fill: NAVY, color: WHITE, wrap: false });
  mergeAndStyle(ws, row, 13, row, COLS, textWithComment(monthlyValues.kinyusha), { align: "left", wrap: false });
  row++;

  row++; // spacer

  // ---- Daily grid ----
  const headerRow = row;
  // 配食者名/利用者確認印 are print-only columns for handwritten fill-in on the
  // printed sheet — not backed by a status_fields row, so they never appear in
  // the Status Input 対象フィールド picker.
  columns.forEach((c, idx) => {
    const cell = ws.getCell(headerRow, idx + 1);
    cell.value = c.label;
    styleCell(cell, { bold: true, fill: NAVY, color: WHITE, size: HEADER_FONT_SIZE, wrap: false });
  });
  ws.getRow(headerRow).height = 22;
  row++;

  const dayRowByDate = new Map(data.days.map((d) => [d.record_date, d]));
  const photoDates = new Set(data.photoDates || []);
  for (let day = 1; day <= data.daysInMonth; day++) {
    const iso = `${data.yearMonth}-${String(day).padStart(2, "0")}`;
    const dayRow = dayRowByDate.get(iso);
    const values = dayRow?.values || {};
    const dateObj = new Date(`${iso}T00:00:00`);

    const dayCell = ws.getCell(row, 1);
    dayCell.value = day;
    styleCell(dayCell, { fill: GRAY, size: 9, wrap: false });

    const weekdayCell = ws.getCell(row, 2);
    weekdayCell.value = rawValue(values.youbi) || WEEKDAY_JA[dateObj.getDay()];
    styleCell(weekdayCell, { fill: GRAY, size: 9, wrap: false });

    // 配食者名 — logged-in user stamped at save time (see StatusMatcher's handleSaveRecord).
    const haitatsushaCell = ws.getCell(row, 3);
    haitatsushaCell.value = rawValue(values.delivery_person) || "";
    styleCell(haitatsushaCell, { fill: GRAY, size: 9, wrap: false });

    // 利用者確認印 — ○ when a photo was uploaded for this day (写真を見る), else blank.
    const kakuninCell = ws.getCell(row, 4);
    kakuninCell.value = photoDates.has(iso) ? "○" : "";
    styleCell(kakuninCell, { fill: GRAY, size: 9, wrap: false });

    const uketoriCell = ws.getCell(row, 5);
    uketoriCell.value = rawValue(values.uketori) || "";
    styleCell(uketoriCell, { fill: GRAY, size: 9, align: "left", wrap: false });

    // Columns 6+ (うけとりコメント, then the daily fields with their group comment
    // columns) follow the `columns` list built above.
    columns.slice(5).forEach((c, i) => {
      const cell = ws.getCell(row, 6 + i);
      if (c.kind === "comment") {
        cell.value = rawComment(values[c.commentKey]);
        styleCell(cell, { fill: c.fill, size: 9, align: "left", wrap: false });
        return;
      }
      const f = c.field;
      const fv = values[f.field_key];
      if (c.kind === "checkbox") {
        cell.value = isChecked(fv) ? "✓" : "";
      } else {
        cell.value = textWithComment(fv);
      }
      styleCell(cell, {
        fill: FIELD_GROUP[f.field_key] ? GROUP_COLOR[FIELD_GROUP[f.field_key]] : WHITE,
        size: 9,
        align: c.kind === "checkbox" ? "center" : "left",
        wrap: false,
      });
    });
    row++;
  }

  row++; // spacer

  // ---- 月次報告欄 (tally table + numbered comment blocks) ----
  mergeAndStyle(ws, row, 1, row, COLS, "月次報告欄", { bold: true, size: 13, fill: ORANGE, color: WHITE });
  row++;

  mergeAndStyle(ws, row, 1, row, 2, "分類", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 3, row, 6, "確認項目", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 7, row, 8, "件数", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 9, row, 9, "", { fill: NAVY });
  mergeAndStyle(
    ws,
    row,
    10,
    row,
    COLS,
    "報告書コメント欄｜該当するものに✓＋必要時のみ一言",
    { bold: true, fill: NAVY, color: WHITE }
  );
  row++;

  const tallyStartRow = row;
  const commentBlocks = buildCommentBlocks(monthlyFields);
  const tallyRowKeys = Object.entries(TALLY_GROUPS).flatMap(([group, keys]) => keys.map((k) => [group, k]));

  tallyRowKeys.forEach(([group, key], idx) => {
    const r = tallyStartRow + idx;
    const label = dfByKey[key]?.field_label || key;
    const count = data.tallies?.[group]?.[key] ?? 0;

    const catCell = ws.getCell(r, 1);
    catCell.value = group;
    ws.mergeCells(r, 1, r, 2);
    styleCell(catCell, { fill: GROUP_COLOR[group], bold: true, size: 9 });

    const itemCell = ws.getCell(r, 3);
    itemCell.value = label;
    ws.mergeCells(r, 3, r, 6);
    styleCell(itemCell, { fill: WHITE, align: "left", size: 9 });

    const countCell = ws.getCell(r, 7);
    countCell.value = count;
    ws.mergeCells(r, 7, r, 8);
    styleCell(countCell, { fill: YELLOW, bold: true, size: 9 });

    ws.getRow(r).height = 26;
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

    const commentCell = ws.getCell(r1, 10);
    ws.mergeCells(r1, 9, r2, COLS);
    const optionsLine = checklistText(block.field, monthlyValues[block.field.field_key]);
    const freeText = block.freeTextField ? textWithComment(monthlyValues[block.freeTextField.field_key]) : "";
    const numeral = CIRCLED_NUMBERS[block.number - 1] || `${block.number}.`;
    const lines = [`${numeral}${block.field.field_label}`, optionsLine];
    if (block.freeTextSuffix) lines.push(`${block.freeTextSuffix}：${freeText}`);
    commentCell.value = lines.filter(Boolean).join("\n");
    styleCell(commentCell, { align: "left", valign: "top", size: 9 });

    cursor += span;
  });
  row = tallyStartRow + tallyRowKeys.length;

  row++; // spacer

  // ---- 総評 ----
  mergeAndStyle(ws, row, 1, row, 2, "総評", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 3, row, COLS, textWithComment(monthlyValues.sohyo), { align: "left", valign: "top" });
  ws.getRow(row).height = 40;
  row++;

  row++; // spacer

  // ---- Footer: 報告日 / 確認者 / 家族・関係機関共有 ----
  mergeAndStyle(ws, row, 1, row, 2, "報告日", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 3, row, 6, textWithComment(monthlyValues.hokokubi), { align: "left" });
  mergeAndStyle(ws, row, 7, row, 8, "確認者", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 9, row, 11, textWithComment(monthlyValues.kakuninsha), { align: "left" });
  mergeAndStyle(ws, row, 12, row, 14, "家族・関係機関共有", { bold: true, fill: NAVY, color: WHITE, size: 9 });
  mergeAndStyle(
    ws,
    row,
    15,
    row,
    COLS,
    mfByKey.kyoyu_status ? checklistText(mfByKey.kyoyu_status, monthlyValues.kyoyu_status) : "",
    { align: "left", size: 9 }
  );

  const lastColLetter = String.fromCharCode(64 + COLS); // COLS <= 26
  ws.pageSetup.printArea = `A1:${lastColLetter}${row}`;

  return workbook;
}

module.exports = { buildReportWorkbook };
