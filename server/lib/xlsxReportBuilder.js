// server/lib/xlsxReportBuilder.js
// Builds a printable .xlsx that mirrors the 状況記録表兼報告書 layout:
// header block -> daily grid (color-coded by group) -> monthly tally table ->
// numbered report-comment blocks -> 総評 -> footer.
const ExcelJS = require("exceljs");
const {
  TOTAL_COLS,
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

  // All 17 columns share one equal width so the grid reads as a uniform table
  // (cells with longer text just wrap within the row instead of overflowing).
  // Note: ExcelJS treats width===9 as its internal "unset" default and silently
  // drops such columns from the file, so avoid that exact value here.
  for (let idx = 0; idx < TOTAL_COLS; idx++) ws.getColumn(idx + 1).width = 9.5;

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

  // ---- Header block: 利用者名/記録月, 配送担当/食事内容, 利用回数/連絡方法, 報告先/先方担当者/記入者 ----
  const [y, m] = data.yearMonth.split("-");
  mergeAndStyle(ws, row, 1, row, 2, "利用者名", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 3, row, 7, data.patient.name || "", { align: "left" });
  mergeAndStyle(ws, row, 8, row, 9, "記録月", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 10, row, TOTAL_COLS, `${Number(y)}年　${Number(m)}月`, { align: "left" });
  row++;

  mergeAndStyle(ws, row, 1, row, 2, "配送担当", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(
    ws,
    row,
    3,
    row,
    7,
    mfByKey.hasso_tanto ? checklistText(mfByKey.hasso_tanto, monthlyValues.hasso_tanto) : "",
    { align: "left" }
  );
  mergeAndStyle(ws, row, 8, row, 9, "食事内容", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(
    ws,
    row,
    10,
    row,
    TOTAL_COLS,
    mfByKey.shokuji_naiyo ? checklistText(mfByKey.shokuji_naiyo, monthlyValues.shokuji_naiyo) : "",
    { align: "left" }
  );
  row++;

  mergeAndStyle(ws, row, 1, row, 2, "利用回数", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 3, row, 7, textWithComment(monthlyValues.riyo_kaisu), { align: "left" });
  mergeAndStyle(ws, row, 8, row, 9, "連絡方法", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(
    ws,
    row,
    10,
    row,
    TOTAL_COLS,
    mfByKey.renraku_hoho ? checklistText(mfByKey.renraku_hoho, monthlyValues.renraku_hoho) : "",
    { align: "left" }
  );
  row++;

  mergeAndStyle(ws, row, 1, row, 2, "報告先", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 3, row, 5, textWithComment(monthlyValues.hokoku_saki), { align: "left" });
  mergeAndStyle(ws, row, 6, row, 7, "先方担当者", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 8, row, 10, textWithComment(monthlyValues.senpo_tantosha), { align: "left" });
  mergeAndStyle(ws, row, 11, row, 12, "記入者", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 13, row, TOTAL_COLS, textWithComment(monthlyValues.kinyusha), { align: "left" });
  row++;

  row++; // spacer

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
    const cell = ws.getCell(headerRow, idx + 1);
    cell.value = label;
    styleCell(cell, { bold: true, fill: NAVY, color: WHITE, size: 9 });
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
    styleCell(dayCell, { fill: GRAY, size: 9 });

    const weekdayCell = ws.getCell(row, 2);
    weekdayCell.value = rawValue(values.youbi) || WEEKDAY_JA[dateObj.getDay()];
    styleCell(weekdayCell, { fill: GRAY, size: 9 });

    // 配食者名 — blank print-only cell, filled in by hand after printing.
    styleCell(ws.getCell(row, 3), { fill: GRAY, size: 9 });

    // 利用者確認印 — ○ when a photo was uploaded for this day (写真を見る), else blank.
    const kakuninCell = ws.getCell(row, 4);
    kakuninCell.value = photoDates.has(iso) ? "○" : "";
    styleCell(kakuninCell, { fill: GRAY, size: 9 });

    const uketoriCell = ws.getCell(row, 5);
    uketoriCell.value = textWithComment(values.uketori);
    styleCell(uketoriCell, { fill: GRAY, size: 9, align: "left" });

    orderedDailyBody.forEach((f, idx) => {
      const cell = ws.getCell(row, 6 + idx);
      const fv = values[f.field_key];
      if (f.field_type === "checkbox") {
        cell.value = isChecked(fv) ? "✓" : "";
      } else {
        cell.value = textWithComment(fv);
      }
      styleCell(cell, {
        fill: FIELD_GROUP[f.field_key] ? GROUP_COLOR[FIELD_GROUP[f.field_key]] : WHITE,
        size: 9,
        align: f.field_type === "checkbox" ? "center" : "left",
        wrap: false,
      });
    });
    row++;
  }

  row++; // spacer

  // ---- 月次報告欄 (tally table + numbered comment blocks) ----
  mergeAndStyle(ws, row, 1, row, TOTAL_COLS, "月次報告欄", { bold: true, size: 13, fill: ORANGE, color: WHITE });
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
    TOTAL_COLS,
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
    ws.mergeCells(r1, 9, r2, TOTAL_COLS);
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
  mergeAndStyle(ws, row, 3, row, TOTAL_COLS, textWithComment(monthlyValues.sohyo), { align: "left", valign: "top" });
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
    TOTAL_COLS,
    mfByKey.kyoyu_status ? checklistText(mfByKey.kyoyu_status, monthlyValues.kyoyu_status) : "",
    { align: "left", size: 9 }
  );

  const lastColLetter = String.fromCharCode(64 + TOTAL_COLS); // TOTAL_COLS <= 26
  ws.pageSetup.printArea = `A1:${lastColLetter}${row}`;

  return workbook;
}

module.exports = { buildReportWorkbook };
