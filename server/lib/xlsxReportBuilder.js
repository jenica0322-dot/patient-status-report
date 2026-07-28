// server/lib/xlsxReportBuilder.js
// Builds a printable .xlsx that mirrors the 状況記録表兼報告書 layout:
// header block -> daily grid (color-coded by group) -> monthly tally table ->
// numbered report-comment blocks -> 総評 -> footer.
const ExcelJS = require("exceljs");

const TOTAL_COLS = 17;
const NAVY = "FF1F2D4A";
const ORANGE = "FFF2994A";
const GRAY = "FFE9E9E9";
const PEACH = "FFFBE0CF";
const BLUE = "FFD9ECF9";
const GREEN = "FFDDF0DD";
const PINK = "FFFBDCE4";
const YELLOW = "FFFCF1C7";
const WHITE = "FFFFFFFF";

// Column group -> fill color for the daily grid (mirrors reportController's TALLY_GROUPS,
// plus the two free-text columns that visually belong to the blue/green groups).
const GROUP_COLOR = {
  食事: PEACH,
  体調: BLUE,
  支援: GREEN,
  連絡: PINK,
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

  const colWidths = [4, 5, 9, 6, 6, 6, 8, 9, 8, 10, 8, 9, 8, 10, 8, 7, 20];
  colWidths.forEach((w, idx) => (ws.getColumn(idx + 1).width = w));

  const monthlyValues = data.monthlyReport || {};
  const mfByKey = Object.fromEntries(monthlyFields.map((f) => [f.field_key, f]));
  const dfByKey = Object.fromEntries(dailyFields.map((f) => [f.field_key, f]));
  const orderedDailyBody = dailyFields
    .filter((f) => f.field_key !== "youbi" && f.field_key !== "uketori")
    .sort((a, b) => a.order_index - b.order_index);

  let row = 1;

  // ---- Header block: 利用者名/記録月, 配送担当/食事内容, 利用回数/連絡方法, 報告先/先方担当者/記入者 ----
  const [y, m] = data.yearMonth.split("-");
  mergeAndStyle(ws, row, 1, row, 2, "利用者名", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 3, row, 7, data.patient.name || "", { align: "left" });
  mergeAndStyle(ws, row, 8, row, 9, "記録月", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 10, row, 17, `${Number(y)}年　${Number(m)}月`, { align: "left" });
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
    17,
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
    17,
    mfByKey.renraku_hoho ? checklistText(mfByKey.renraku_hoho, monthlyValues.renraku_hoho) : "",
    { align: "left" }
  );
  row++;

  mergeAndStyle(ws, row, 1, row, 2, "報告先", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 3, row, 5, textWithComment(monthlyValues.hokoku_saki), { align: "left" });
  mergeAndStyle(ws, row, 6, row, 7, "先方担当者", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 8, row, 10, textWithComment(monthlyValues.senpo_tantosha), { align: "left" });
  mergeAndStyle(ws, row, 11, row, 12, "記入者", { bold: true, fill: NAVY, color: WHITE });
  mergeAndStyle(ws, row, 13, row, 17, textWithComment(monthlyValues.kinyusha), { align: "left" });
  row++;

  row++; // spacer

  // ---- Daily grid ----
  const headerRow = row;
  const headerCells = ["日", dfByKey.youbi?.field_label || "曜", dfByKey.uketori?.field_label || "受取"];
  orderedDailyBody.forEach((f) => headerCells.push(f.field_label));
  headerCells.forEach((label, idx) => {
    const cell = ws.getCell(headerRow, idx + 1);
    cell.value = label;
    styleCell(cell, { bold: true, fill: NAVY, color: WHITE, size: 9 });
  });
  ws.getRow(headerRow).height = 22;
  row++;

  const dayRowByDate = new Map(data.days.map((d) => [d.record_date, d]));
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

    const uketoriCell = ws.getCell(row, 3);
    uketoriCell.value = textWithComment(values.uketori);
    styleCell(uketoriCell, { fill: GRAY, size: 9, align: "left" });

    orderedDailyBody.forEach((f, idx) => {
      const cell = ws.getCell(row, 4 + idx);
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

  ws.pageSetup.printArea = `A1:Q${row}`;

  return workbook;
}

module.exports = { buildReportWorkbook };
