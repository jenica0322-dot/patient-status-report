// app/lib/reportLayout.ts
// Client side of the マスター設定 report layout (報告書コメント欄 blocks and the
// footer row). Mirrors server/lib/reportLayout.js — keep the two in step.

import { API_BASE } from "./statusApi";
import { CIRCLED_NUMBERS } from "./reportFormat";

export type FooterItemType = "date" | "text" | "checklist";

export interface CommentBlockConfig {
  fieldKey: string;
  title: string;
  options: string[];
  visible: boolean;
  freeText: { enabled: boolean; fieldKey: string; label: string };
}

export interface FooterItemConfig {
  fieldKey: string;
  label: string;
  type: FooterItemType;
  options: string[];
  visible: boolean;
}

export interface ReportLayout {
  version: 1;
  commentBlocks: CommentBlockConfig[];
  footer: { perRow: number; items: FooterItemConfig[] };
}

export const FOOTER_TYPE_LABELS: Record<FooterItemType, string> = {
  date: "日付",
  text: "テキスト",
  checklist: "チェック（選択肢）",
};

export const MAX_PER_ROW = 4;

async function layoutRequest(method: "GET" | "PUT" | "DELETE", body?: unknown) {
  const r = await fetch(`${API_BASE}/api/report-layout`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await r.json();
  } catch {
    /* ignore */
  }
  if (r.status === 404) {
    // The API routes are read once at server start — an older server process
    // doesn't know this one yet.
    throw new Error("サーバーにこの機能がまだありません。サーバーを再起動してください（npm run dev）");
  }
  if (!r.ok) throw new Error(json?.error || `request failed (${r.status})`);
  return json as { layout: ReportLayout; isDefault: boolean };
}

export const fetchReportLayout = () => layoutRequest("GET");
export const saveReportLayout = (layout: ReportLayout) => layoutRequest("PUT", { layout });
export const resetReportLayout = () => layoutRequest("DELETE");

// A new, unused field key for an added item (e.g. "rb_m3k9x2").
export function newFieldKey(prefix: "rb" | "rf"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export type NumberedBlock = CommentBlockConfig & { number: number; numeral: string };

// Visible comment blocks, numbered ①②… in display order.
export function visibleCommentBlocks(layout: ReportLayout | null | undefined): NumberedBlock[] {
  return (layout?.commentBlocks || [])
    .filter((b) => b.visible)
    .map((b, i) => ({ ...b, number: i + 1, numeral: CIRCLED_NUMBERS[i] || `${i + 1}.` }));
}

// How many 月次報告 rows each comment block covers next to the tally rows (see
// server/lib/reportLayout.js planCommentRows).
export function planCommentRows(tallyRowCount: number, blockCount: number): { spans: number[]; totalRows: number } {
  if (blockCount === 0) return { spans: [], totalRows: tallyRowCount };
  if (blockCount > tallyRowCount) return { spans: new Array(blockCount).fill(1), totalRows: blockCount };
  if (blockCount * 2 <= tallyRowCount) {
    const spans = new Array(blockCount).fill(2);
    spans[blockCount - 1] = tallyRowCount - 2 * (blockCount - 1);
    return { spans, totalRows: tallyRowCount };
  }
  const extra = tallyRowCount - blockCount;
  return { spans: Array.from({ length: blockCount }, (_, i) => (i < extra ? 2 : 1)), totalRows: tallyRowCount };
}

export type FooterCell = { item: FooterItemConfig; labelSpan: number; valueSpan: number };

// Visible footer items in rows of `perRow`, with label / value column spans
// across `totalCols`.
export function planFooterRows(layout: ReportLayout | null | undefined, totalCols: number): FooterCell[][] {
  const items = (layout?.footer?.items || []).filter((it) => it.visible);
  const perRow = Math.max(1, layout?.footer?.perRow || 3);
  const rows: FooterCell[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    const rowItems = items.slice(i, i + perRow);
    const labelSpans = rowItems.map((it) => (String(it.label).length > 6 ? 3 : 2));
    const valueCols = Math.max(rowItems.length, totalCols - labelSpans.reduce((a, b) => a + b, 0));
    const base = Math.floor(valueCols / rowItems.length);
    rows.push(
      rowItems.map((item, j) => ({
        item,
        labelSpan: labelSpans[j],
        valueSpan: j === rowItems.length - 1 ? valueCols - base * (rowItems.length - 1) : base,
      }))
    );
  }
  return rows;
}
