// app/report/page.tsx

"use client";

import { useEffect, useState, useMemo, useRef, Fragment } from "react";
import { Container, Row, Col, Card, Form, Spinner, Alert, Button, Modal } from "react-bootstrap";
import { FileText, Calendar, FileEarmarkExcel, FileEarmarkPdf, Images, Trash, QrCodeScan } from "react-bootstrap-icons";
import Layout from "../components/layout/Layout";
import ReportPatientPicker from "../components/report/ReportPatientPicker";
import QRScanner from "../components/dashboard/QRScanner";
import { parseTargetUserId, findPatientByTargetUserId } from "../lib/qrTargetUser";
import { JaMonthInput, JaDateInput } from "../components/JaDatePicker";
import { usePatient } from "../context/PatientContext";
import {
  fetchStatusFields,
  fetchPatientReport,
  patientReportExportUrl,
  patientReportExportPdfUrl,
  fetchReportPhotos,
  deleteStatusPhoto,
  saveStatusRecord,
  StatusPhoto,
} from "../lib/statusApi";
import PhotoLightbox from "../components/dashboard/PhotoLightbox";
import { markVoiceFlowResume } from "../lib/voiceFlowResume";
import galleryStyles from "../styles/PhotoGallery.module.css";
import {
  ReportField,
  TALLY_GROUPS,
  FIELD_GROUP,
  WEEKDAY_JA,
  isChecked,
  textWithComment,
  rawValue,
  rawComment,
  checklistOptions,
  groupColClass,
  tallyCategoryClass,
} from "../lib/reportFormat";
import styles from "../styles/MonthlyReportGrid.module.css";
import {
  ReportLayout,
  FooterItemConfig,
  visibleCommentBlocks,
  planCommentRows,
  planFooterRows,
} from "../lib/reportLayout";

// A layout item's options in the shape <Checklist> takes.
function optionsField(fieldKey: string, label: string, options: string[]): ReportField {
  return { field_key: fieldKey, field_label: label, field_type: "preset", phrases: options, order_index: 0 };
}

const PATIENT_SELECT_FIELD_LABEL = "利用者選択";

// Two taps/clicks on the same cell within this window open it for editing.
// Handled from click timing (not onDoubleClick) so a double-tap on a phone
// works the same as a mouse double-click.
const DOUBLE_TAP_MS = 400;

// Checking one 食事 box in the report clears the ones it can't coexist with —
// the same choices the Status Input 食べ残し picker allows. 問題なし is a
// completed meal, so it goes together with 完食.
const MEAL_CLEARS: Record<string, string[]> = {
  kanshoku: ["hanbun", "nokoshi"],
  hanbun: ["kanshoku", "nokoshi", "mondai_nashi"],
  nokoshi: ["kanshoku", "hanbun", "mondai_nashi"],
  mondai_nashi: ["hanbun", "nokoshi"],
};

// A stored field value as a { value, comment } object (older rows may hold a
// bare value).
function asFieldObj(v: any): { value?: any; comment?: string } {
  if (v && typeof v === "object" && !Array.isArray(v)) return { ...v };
  if (v === undefined || v === null) return {};
  return { value: v };
}

type CellEdit = { date: string; key: string; part: "value" | "comment"; numeric: boolean; draft: string };

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 'YYYY/MM/DD HH:mm' in Japan time — matches the stamp burned into the image
// by server/lib/photoTimestamp.js.
function formatPhotoTimestamp(iso: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

// A preset field's options as ☐/☑ boxes. With `onPick`, each box is clickable
// (one choice per field, as stored — clicking the checked one clears it).
function Checklist({
  field,
  value,
  onPick,
}: {
  field: ReportField | undefined;
  value: any;
  onPick?: (label: string, selected: boolean) => void;
}) {
  const options = checklistOptions(field, value);
  const clickable = !!onPick && !!field?.phrases?.length;
  return (
    <span className={styles.checklist}>
      {options.map((o, i) =>
        clickable ? (
          <button
            key={i}
            type="button"
            role="checkbox"
            aria-checked={o.selected}
            className={`${styles.checklistOption} ${styles.checklistButton} ${o.selected ? styles.checklistOptionOn : ""}`}
            onClick={() => onPick!(o.label, o.selected)}
          >
            {o.selected ? "☑" : "☐"}
            {o.label}
          </button>
        ) : (
          <span
            key={i}
            className={`${styles.checklistOption} ${o.selected ? styles.checklistOptionOn : ""}`}
          >
            {o.selected ? "☑" : "☐"}
            {o.label}
          </span>
        )
      )}
    </span>
  );
}

// A daily comment cell's text. On laptop screens it stays on one line and is
// cut off with "…" (full text on hover) so a long comment can't widen the grid.
function CommentText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span className={styles.commentText} title={text}>
      {text}
    </span>
  );
}

export default function ReportPage() {
  const { selectedPatient } = usePatient();

  // The report's own 対象者: starts as the patient selected for Status Input,
  // but can be switched here to anyone without changing that selection.
  const [viewPatient, setViewPatient] = useState<{ id: number; name: string } | null>(null);
  const shownPatient = viewPatient ?? selectedPatient ?? null;
  const patientId = shownPatient?.id ?? null;

  // QR読取 here switches the report's 対象者 the same way the dropdown does —
  // the Status Input selection is left alone.
  const [qrOpen, setQrOpen] = useState(false);
  const [qrSearching, setQrSearching] = useState(false);
  const [qrMsg, setQrMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const handleQrScan = async (raw: string) => {
    setQrOpen(false);
    const targetUserId = parseTargetUserId(raw);
    if (!targetUserId) {
      setQrMsg({ ok: false, text: "QRコードから利用者IDを読み取れませんでした" });
      return;
    }
    setQrSearching(true);
    try {
      const patient = await findPatientByTargetUserId(targetUserId);
      if (patient) {
        setViewPatient({ id: patient.id, name: patient.name });
        setQrMsg({ ok: true, text: `${patient.name} を表示しています` });
      } else {
        setQrMsg({ ok: false, text: `ID ${targetUserId} の利用者が見つかりませんでした` });
      }
    } catch (e) {
      console.error("QR patient lookup failed", e);
      setQrMsg({ ok: false, text: "利用者の検索に失敗しました" });
    } finally {
      setQrSearching(false);
    }
  };
  const [yearMonth, setYearMonth] = useState(currentYearMonth());

  const [dailyFields, setDailyFields] = useState<ReportField[]>([]);
  const [monthlyFields, setMonthlyFields] = useState<ReportField[]>([]);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reportPhotos, setReportPhotos] = useState<StatusPhoto[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<number | null>(null);

  // Daily-grid cell editing (double-click / double-tap).
  const [cellEdit, setCellEdit] = useState<CellEdit | null>(null);
  const cellEditRef = useRef<CellEdit | null>(null);
  const [savingDates, setSavingDates] = useState<Set<string>>(new Set());
  const [cellError, setCellError] = useState<string | null>(null);
  const lastTapRef = useRef<{ id: string; t: number } | null>(null);
  // The background refresh is held off while a cell is open or saving, so it
  // can't briefly put back the old value.
  const pauseRefreshRef = useRef(false);
  // 月次報告 editing: checkbox clicks and the 一言/内容/方針/総評 text lines.
  const [monthlyEdit, setMonthlyEdit] = useState<{ key: string; draft: string } | null>(null);
  const monthlyEditRef = useRef<{ key: string; draft: string } | null>(null);
  const [monthlyPending, setMonthlyPending] = useState(0);
  const monthlySaveChainRef = useRef<Promise<void>>(Promise.resolve());
  pauseRefreshRef.current = cellEdit !== null || savingDates.size > 0 || monthlyEdit !== null || monthlyPending > 0;
  const reportRef = useRef<any>(null);

  // Switching 対象者 or month closes any open cell without saving.
  useEffect(() => {
    cellEditRef.current = null;
    setCellEdit(null);
    monthlyEditRef.current = null;
    setMonthlyEdit(null);
    setCellError(null);
  }, [patientId, yearMonth]);

  // Going back to 状況入力 after reviewing this report restarts its Target
  // Field voice-over (see StatusMatcher).
  useEffect(() => {
    markVoiceFlowResume();
  }, []);

  useEffect(() => {
    fetchStatusFields("daily_status").then(setDailyFields).catch(() => {});
    fetchStatusFields("monthly_report").then(setMonthlyFields).catch(() => {});
  }, []);

  useEffect(() => {
    if (!patientId) {
      setReport(null);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchPatientReport(patientId, yearMonth);
        setReport(data);
      } catch (e) {
        console.error(e);
        setError("報告書の読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [patientId, yearMonth]);

  // A Target Field choice in Status Input is saved right away (possibly from
  // another tab/screen) — quietly re-fetch so the report shows it without a
  // manual refresh. No spinner, and a failed refresh keeps what's on screen.
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    const refresh = () => {
      // Skip while the tab is in the background; visibilitychange below
      // refreshes as soon as it's shown again.
      if (document.visibilityState === "hidden") return;
      if (pauseRefreshRef.current) return;
      fetchPatientReport(patientId, yearMonth)
        .then((data) => {
          if (!cancelled && !pauseRefreshRef.current) setReport(data);
        })
        .catch((e) => console.error("failed to refresh report", e));
    };
    const intervalId = setInterval(refresh, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [patientId, yearMonth]);

  useEffect(() => {
    if (!patientId) {
      setReportPhotos([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchReportPhotos(patientId, yearMonth)
        .then((photos) => {
          if (!cancelled) setReportPhotos(photos);
        })
        .catch((e) => {
          console.error("failed to load report photos", e);
          if (!cancelled) setReportPhotos([]);
        });
    };
    load();
    // A photo can be added from Status Input (写真追加) in another tab/screen —
    // poll so 利用者確認印 picks it up here without a manual page refresh.
    // Polling pauses while the tab is hidden and catches up when it's shown.
    const intervalId = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, 8000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [patientId, yearMonth]);

  const photoGroups = useMemo(() => {
    const groups = new Map<string, StatusPhoto[]>();
    for (const photo of reportPhotos) {
      const label = photo.record_date
        ? `${photo.record_date}`
        : photo.record_year_month
        ? `${photo.record_year_month}（月次報告）`
        : "その他";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(photo);
    }
    return Array.from(groups.entries());
  }, [reportPhotos]);

  const handleDeleteReportPhoto = async (photo: StatusPhoto) => {
    setDeletingPhotoId(photo.id);
    try {
      await deleteStatusPhoto(photo.id);
      setReportPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      setLightboxIndex((idx) => {
        if (idx === null) return idx;
        const remaining = reportPhotos.filter((p) => p.id !== photo.id);
        if (remaining.length === 0) return null;
        return Math.min(idx, remaining.length - 1);
      });
    } catch (e) {
      console.error("failed to delete photo", e);
    } finally {
      setDeletingPhotoId(null);
    }
  };

  const dfByKey = useMemo(
    () => Object.fromEntries(dailyFields.map((f) => [f.field_key, f])),
    [dailyFields]
  );
  const mfByKey = useMemo(
    () => Object.fromEntries(monthlyFields.map((f) => [f.field_key, f])),
    [monthlyFields]
  );
  const orderedDailyBody = useMemo(
    () =>
      dailyFields
        .filter(
          (f) =>
            f.field_key !== "youbi" &&
            f.field_key !== "uketori" &&
            // メモ isn't shown in the report grid (its data stays in the record).
            f.field_key !== "memo" &&
            f.field_label !== PATIENT_SELECT_FIELD_LABEL
        )
        .sort((a, b) => a.order_index - b.order_index),
    [dailyFields]
  );
  // Comment columns in the daily grid. A Status Input comment is stored on the
  // field it was typed for — group pickers (食べ残し/体調) keep theirs on their
  // anchor field — so each column reads that key's comment. うけとり's sits right
  // after the うけとり column; the group ones after the group's last column.
  const groupCommentAfter = useMemo(() => {
    const groups = [
      { group: "食事", commentKey: "kanshoku", label: "食べ残しコメント" },
      { group: "体調", commentKey: "shokuyoku_teika", label: "体調コメント" },
    ];
    const m = new Map<string, { commentKey: string; label: string; group: string }>();
    groups.forEach((g) => {
      const last = [...orderedDailyBody].reverse().find((f) => FIELD_GROUP[f.field_key] === g.group);
      if (last) m.set(last.field_key, g);
    });
    return m;
  }, [orderedDailyBody]);
  const commentColCount = 1 + groupCommentAfter.size;

  // 報告書コメント欄 blocks and the footer follow the マスター設定 layout, which
  // comes with every report fetch (so a layout change shows on the next refresh).
  const layout: ReportLayout | null = report?.layout ?? null;
  const commentBlocks = useMemo(() => visibleCommentBlocks(layout), [layout]);
  const tallyRowKeys = useMemo(
    () => Object.entries(TALLY_GROUPS).flatMap(([group, keys]) => keys.map((k) => [group, k])),
    []
  );
  // Which block starts on each 月次報告 row ("skip" = covered by the block above).
  const commentRowPlan = useMemo(() => {
    const plan = planCommentRows(tallyRowKeys.length, commentBlocks.length);
    const slots: ({ block: (typeof commentBlocks)[number]; span: number } | "skip" | null)[] = new Array(
      plan.totalRows
    ).fill(null);
    let cursor = 0;
    commentBlocks.forEach((block, i) => {
      slots[cursor] = { block, span: plan.spans[i] };
      for (let k = 1; k < plan.spans[i]; k++) slots[cursor + k] = "skip";
      cursor += plan.spans[i];
    });
    return slots;
  }, [tallyRowKeys.length, commentBlocks]);

  const monthlyValues = report?.monthlyReport || {};
  const dayRowByDate = useMemo(() => {
    const m = new Map<string, any>();
    (report?.days || []).forEach((d: any) => m.set(d.record_date, d));
    return m;
  }, [report]);
  reportRef.current = report;

  // Saves one day's record after `update` changes its values. The record is
  // saved whole (the API replaces it), so the update starts from the latest
  // values on screen — every other field of that day is kept as it is.
  const saveDayValues = async (iso: string, update: (v: Record<string, any>) => Record<string, any>) => {
    if (!patientId || savingDates.has(iso)) return;
    const current = reportRef.current;
    const prevValues = (current?.days || []).find((d: any) => d.record_date === iso)?.values || {};
    const nextValues = update({ ...prevValues });

    // Show the change right away.
    const optimistic = {
      ...current,
      days: [
        ...(current?.days || []).filter((d: any) => d.record_date !== iso),
        { record_date: iso, values: nextValues },
      ].sort((a: any, b: any) => String(a.record_date).localeCompare(String(b.record_date))),
    };
    reportRef.current = optimistic;
    setReport(optimistic);
    setCellError(null);
    setSavingDates((s) => new Set(s).add(iso));
    const forPatient = patientId;
    const forMonth = yearMonth;
    try {
      await saveStatusRecord({ screen_key: "daily_status", patient_id: forPatient, record_date: iso, values: nextValues });
    } catch (e) {
      console.error("failed to save cell", e);
      setCellError(`${Number(iso.slice(8))}日の変更を保存できませんでした。もう一度お試しください。`);
    } finally {
      setSavingDates((s) => {
        const n = new Set(s);
        n.delete(iso);
        return n;
      });
      // Re-read so the tallies (件数) and the saved state are exact.
      fetchPatientReport(forPatient, forMonth)
        .then((data) => {
          if (reportRef.current?.patient?.id === data?.patient?.id && reportRef.current?.yearMonth === data?.yearMonth) {
            setReport(data);
          }
        })
        .catch((e) => console.error("failed to refresh report", e));
    }
  };

  // Opens a cell when it's tapped/clicked twice in a row.
  const handleCellTap = (cellId: string, open: () => void) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && last.id === cellId && now - last.t < DOUBLE_TAP_MS) {
      lastTapRef.current = null;
      open();
    } else {
      lastTapRef.current = { id: cellId, t: now };
    }
  };

  const startCellEdit = (edit: Omit<CellEdit, "draft">) => {
    const values = reportRef.current?.days?.find((d: any) => d.record_date === edit.date)?.values || {};
    const draft = edit.part === "comment" ? rawComment(values[edit.key]) : String(rawValue(values[edit.key]) ?? "");
    const next = { ...edit, draft };
    cellEditRef.current = next;
    setCellEdit(next);
  };

  const cancelCellEdit = () => {
    cellEditRef.current = null;
    setCellEdit(null);
  };

  const commitCellEdit = () => {
    const edit = cellEditRef.current;
    if (!edit) return;
    cellEditRef.current = null;
    setCellEdit(null);
    const values = reportRef.current?.days?.find((d: any) => d.record_date === edit.date)?.values || {};
    const before = edit.part === "comment" ? rawComment(values[edit.key]) : String(rawValue(values[edit.key]) ?? "");
    const text = edit.draft.trim();
    if (text === before) return;
    let stored: any = text;
    if (edit.part === "value" && edit.numeric && text !== "" && !Number.isNaN(Number(text))) stored = Number(text);
    saveDayValues(edit.date, (v) => ({ ...v, [edit.key]: { ...asFieldObj(v[edit.key]), [edit.part]: stored } }));
  };

  const toggleCheckCell = (iso: string, key: string) =>
    saveDayValues(iso, (v) => {
      const on = !isChecked(v[key]);
      const next = { ...v, [key]: { ...asFieldObj(v[key]), value: on } };
      if (on) {
        for (const k of MEAL_CLEARS[key] || []) {
          if (isChecked(next[k])) next[k] = { ...asFieldObj(next[k]), value: false };
        }
        if (key === "mondai_nashi") next.kanshoku = { ...asFieldObj(next.kanshoku), value: true };
      } else if (key === "kanshoku" && isChecked(next.mondai_nashi)) {
        next.mondai_nashi = { ...asFieldObj(next.mondai_nashi), value: false };
      }
      return next;
    });

  // Props for an editable daily cell: double-click / double-tap opens it, and
  // while open it shows a text box (Enter/blur saves, Esc cancels).
  const editableCell = (iso: string, key: string, part: "value" | "comment", opts: { checkbox?: boolean; numeric?: boolean } = {}) => {
    const cellId = `${iso}|${key}|${part}`;
    const isEditing = cellEdit?.date === iso && cellEdit.key === key && cellEdit.part === part;
    const saving = savingDates.has(iso);
    return {
      isEditing,
      className: `${styles.editableCell} ${isEditing ? styles.editingCell : ""} ${saving ? styles.savingCell : ""}`,
      title: opts.checkbox ? "ダブルクリックで ✓ を切り替え" : "ダブルクリックで編集",
      onClick: () => {
        if (isEditing || saving) return;
        handleCellTap(cellId, () => {
          if (opts.checkbox) toggleCheckCell(iso, key);
          else startCellEdit({ date: iso, key, part, numeric: !!opts.numeric });
        });
      },
    };
  };

  // Saves the month's 月次報告 record after `update` changes its values. Shown
  // at once; saves run one after another, each with the latest values, so
  // quick successive clicks all land.
  const saveMonthlyValues = (update: (v: Record<string, any>) => Record<string, any>) => {
    if (!patientId) return;
    const current = reportRef.current;
    const nextValues = update({ ...(current?.monthlyReport || {}) });
    const optimistic = { ...current, monthlyReport: nextValues };
    reportRef.current = optimistic;
    setReport(optimistic);
    setCellError(null);
    setMonthlyPending((n) => n + 1);
    const forPatient = patientId;
    const forMonth = yearMonth;
    monthlySaveChainRef.current = monthlySaveChainRef.current.then(async () => {
      try {
        await saveStatusRecord({
          screen_key: "monthly_report",
          patient_id: forPatient,
          record_year_month: forMonth,
          values: nextValues,
        });
      } catch (e) {
        console.error("failed to save monthly report", e);
        setCellError("月次報告欄の変更を保存できませんでした。もう一度お試しください。");
        fetchPatientReport(forPatient, forMonth)
          .then((data) => {
            if (reportRef.current?.patient?.id === data?.patient?.id && reportRef.current?.yearMonth === data?.yearMonth) {
              setReport(data);
            }
          })
          .catch(() => {});
      } finally {
        setMonthlyPending((n) => n - 1);
      }
    });
  };

  const pickMonthlyOption = (key: string, label: string, selected: boolean) =>
    saveMonthlyValues((v) => ({ ...v, [key]: { ...asFieldObj(v[key]), value: selected ? "" : label } }));

  const startMonthlyEdit = (key: string) => {
    const next = { key, draft: String(rawValue(reportRef.current?.monthlyReport?.[key]) ?? "") };
    monthlyEditRef.current = next;
    setMonthlyEdit(next);
  };

  const commitMonthlyEdit = () => {
    const edit = monthlyEditRef.current;
    if (!edit) return;
    monthlyEditRef.current = null;
    setMonthlyEdit(null);
    const before = String(rawValue(reportRef.current?.monthlyReport?.[edit.key]) ?? "");
    const text = edit.draft.trim();
    if (text === before) return;
    saveMonthlyValues((v) => ({ ...v, [edit.key]: { ...asFieldObj(v[edit.key]), value: text } }));
  };

  // A 月次報告 text line: shows its text, double-click / double-tap opens a
  // text box (Enter/blur saves, Esc cancels).
  const monthlyText = (key: string) => {
    if (monthlyEdit?.key === key) {
      return (
        <input
          autoFocus
          className={styles.cellInput}
          value={monthlyEdit.draft}
          onChange={(e) => {
            const next = monthlyEditRef.current ? { ...monthlyEditRef.current, draft: e.target.value } : null;
            monthlyEditRef.current = next;
            setMonthlyEdit(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              commitMonthlyEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              monthlyEditRef.current = null;
              setMonthlyEdit(null);
            }
          }}
          onBlur={commitMonthlyEdit}
        />
      );
    }
    const text = textWithComment(report?.monthlyReport?.[key]);
    return (
      <span
        className={styles.monthlyTextEditable}
        title="ダブルクリックで編集"
        onClick={() => handleCellTap(`monthly|${key}`, () => startMonthlyEdit(key))}
      >
        {text || " "}
      </span>
    );
  };

  // One footer item's editable value, by its マスター設定 type.
  const footerValue = (item: FooterItemConfig) => {
    const key = item.fieldKey;
    if (item.type === "date") {
      return (
        // Picked from a calendar, saved as soon as a day is chosen.
        <JaDateInput
          className={styles.cellInput}
          maxWidth={220}
          value={String(rawValue(report?.monthlyReport?.[key]) ?? "").trim().replace(/\//g, "-")}
          onChange={(iso) => {
            if (iso === String(rawValue(reportRef.current?.monthlyReport?.[key]) ?? "")) return;
            saveMonthlyValues((v) => ({ ...v, [key]: { ...asFieldObj(v[key]), value: iso } }));
          }}
        />
      );
    }
    if (item.type === "checklist") {
      return (
        <Checklist
          field={optionsField(key, item.label, item.options)}
          value={report?.monthlyReport?.[key]}
          onPick={(label, sel) => pickMonthlyOption(key, label, sel)}
        />
      );
    }
    return monthlyText(key);
  };

  const cellEditor = () => (
    <input
      autoFocus
      className={styles.cellInput}
      value={cellEdit?.draft ?? ""}
      onChange={(e) => {
        const next = cellEditRef.current ? { ...cellEditRef.current, draft: e.target.value } : null;
        cellEditRef.current = next;
        setCellEdit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          commitCellEdit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelCellEdit();
        }
      }}
      onBlur={commitCellEdit}
    />
  );
  // Drives 利用者確認印's ○ mark. Derived from reportPhotos (not report.photoDates,
  // a one-time snapshot from the initial fetch) so it updates immediately when a
  // photo is deleted here, or picked up by the polling above.
  const photoDateSet = useMemo(
    () => new Set(reportPhotos.filter((p) => p.record_date).map((p) => p.record_date as string)),
    [reportPhotos]
  );

  const [y, m] = yearMonth.split("-");

  // 日/曜/配食者名/利用者確認印/受取 + one column per daily field + the comment
  // columns. 配食者名 and 利用者確認印 are print-only columns for handwritten
  // fill-in — not backed by a status_fields row, so they never show up in the
  // Status Input 対象フィールド picker. The header-block rows and the sections
  // below derive their trailing spans from this so they stay aligned if a field
  // is added or removed in registerfield.
  const totalCols = 5 + orderedDailyBody.length + commentColCount;
  const commentColSpan = totalCols - 8; // 分類(2) + 確認項目(4) + 件数(2)
  const footerRows = planFooterRows(layout, totalCols);

  return (
    <Layout>
      <Container fluid className="py-2">
        <div className="d-flex align-items-center mb-3">
          <div
            className="d-flex align-items-center justify-content-center me-3 flex-shrink-0"
            style={{
              width: 48,
              height: 48,
              borderRadius: "var(--radius-md)",
              background: "var(--gradient-primary)",
              color: "#fff",
            }}
          >
            <FileText size={22} />
          </div>
          <div>
            <h1 className="h4 mb-0 fw-bold">報告書</h1>
            <p className="text-muted mb-0 small">利用者ごとの月次状況記録表兼報告書</p>
          </div>
        </div>

        <Card className={`mb-3 ${styles.noPrint} ${styles.toolbarCard}`}>
          <Card.Body>
            <Row className="g-3 align-items-end">
              <Col md={5} className={styles.toolbarUserCol}>
                <Form.Label>対象者</Form.Label>
                <div className="d-flex gap-2 align-items-stretch">
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <ReportPatientPicker
                      className={styles.toolbarText}
                      value={shownPatient ? { id: shownPatient.id, name: shownPatient.name } : null}
                      onChange={(p) => {
                        setQrMsg(null);
                        setViewPatient({ id: p.id, name: p.name });
                      }}
                    />
                  </div>
                  <Button
                    variant="outline-primary"
                    className={`text-nowrap d-flex align-items-center gap-1 ${styles.toolbarText}`}
                    onClick={() => {
                      setQrMsg(null);
                      setQrOpen(true);
                    }}
                    disabled={qrSearching}
                  >
                    {qrSearching ? <Spinner animation="border" size="sm" /> : <QrCodeScan />}
                    <span>QR読取</span>
                  </Button>
                </div>
                {qrMsg && (
                  <div className={`small mt-1 ${qrMsg.ok ? "text-success" : "text-danger"}`}>
                    {qrMsg.ok ? "✅ " : "❌ "}
                    {qrMsg.text}
                  </div>
                )}
              </Col>
              <Col md={4} className={styles.toolbarDateCol}>
                <Form.Label>
                  <Calendar className="me-1" />
                  記録月
                </Form.Label>
                <JaMonthInput
                  className={`form-control ${styles.toolbarText} ${styles.monthText}`}
                  value={yearMonth}
                  onChange={setYearMonth}
                />
              </Col>
              <Col md={3} className={`text-md-end ${styles.toolbarActionsCol}`}>
                {patientId && (
                  <div className={`d-flex gap-2 justify-content-md-end ${styles.toolbarActions}`}>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      className={`text-nowrap ${styles.toolbarText}`}
                      onClick={() => setShowGallery(true)}
                      disabled={reportPhotos.length === 0}
                    >
                      <Images className="me-1" />
                      写真を見る{reportPhotos.length > 0 ? `（${reportPhotos.length}）` : ""}
                    </Button>
                    <a
                      className={`btn btn-success btn-sm text-nowrap ${styles.toolbarText}`}
                      href={patientReportExportUrl(patientId, yearMonth)}
                    >
                      <FileEarmarkExcel className="me-1" />
                      Excel印刷
                    </a>
                    <a
                      className={`btn btn-danger btn-sm text-nowrap ${styles.toolbarText}`}
                      href={patientReportExportPdfUrl(patientId, yearMonth)}
                    >
                      <FileEarmarkPdf className="me-1" />
                      PDF印刷
                    </a>
                  </div>
                )}
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {loading && (
          <div className="text-center py-5">
            <Spinner animation="border" />
          </div>
        )}
        {error && <Alert variant="danger">{error}</Alert>}

        {!loading && !patientId && (
          <Card className="text-center py-5">
            <Card.Body className="text-muted">上の「対象者」から利用者を選択してください</Card.Body>
          </Card>
        )}

        {!loading && report && (
          <Card className="mb-4">
            <Card.Body className={styles.reportBody}>
              <p className={styles.scrollHint}>← 横にスクロールできます →</p>
              <p className={styles.editHint}>
                日ごとの欄はダブルクリック（スマホはダブルタップ）で編集できます。✓欄は切り替え、文字欄は Enter で保存・Esc で取消。
              </p>
              {cellError && (
                <Alert variant="danger" className="py-1 px-2 mb-2 small" dismissible onClose={() => setCellError(null)}>
                  {cellError}
                </Alert>
              )}
              <div className={styles.gridScroll}>
                <table className={styles.grid}>
                <tbody>
                  {/* Header block */}
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      利用者名
                    </td>
                    <td className={styles.valueCell} colSpan={5}>
                      {report.patient.name}
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      記録月
                    </td>
                    <td className={styles.valueCell} colSpan={totalCols - 9}>
                      {Number(y)}年　{Number(m)}月
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      配送担当
                    </td>
                    <td className={styles.valueCell} colSpan={5}>
                      <Checklist field={mfByKey.hasso_tanto} value={monthlyValues.hasso_tanto} onPick={(label, sel) => pickMonthlyOption("hasso_tanto", label, sel)} />
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      食事内容
                    </td>
                    <td className={styles.valueCell} colSpan={totalCols - 9}>
                      <Checklist field={mfByKey.shokuji_naiyo} value={monthlyValues.shokuji_naiyo} onPick={(label, sel) => pickMonthlyOption("shokuji_naiyo", label, sel)} />
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      利用回数
                    </td>
                    <td className={styles.valueCell} colSpan={5}>
                      {monthlyText("riyo_kaisu")}
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      連絡方法
                    </td>
                    <td className={styles.valueCell} colSpan={totalCols - 9}>
                      <Checklist field={mfByKey.renraku_hoho} value={monthlyValues.renraku_hoho} onPick={(label, sel) => pickMonthlyOption("renraku_hoho", label, sel)} />
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      報告先
                    </td>
                    <td className={styles.valueCell} colSpan={3}>
                      {monthlyText("hokoku_saki")}
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      先方担当者
                    </td>
                    <td className={styles.valueCell} colSpan={3}>
                      {monthlyText("senpo_tantosha")}
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      記入者
                    </td>
                    <td className={styles.valueCell} colSpan={totalCols - 12}>
                      {monthlyText("kinyusha")}
                    </td>
                  </tr>

                  {/* Daily grid header. 配食者名/利用者確認印 are print-only columns for
                      handwritten fill-in — not backed by a status_fields row, so they never
                      show up in the Status Input 対象フィールド picker. */}
                  <tr className={styles.headerRow}>
                    <th style={{ width: 32 }}>日</th>
                    <th style={{ width: 36 }}>{dfByKey.youbi?.field_label || "曜"}</th>
                    <th style={{ width: 72 }}>配食者名</th>
                    <th style={{ width: 72 }}>利用者確認印</th>
                    <th style={{ width: 64 }}>{dfByKey.uketori?.field_label || "受取"}</th>
                    <th className={styles.colCommentHead}>{dfByKey.uketori?.field_label || "受取"}コメント</th>
                    {orderedDailyBody.map((f) => {
                      const after = groupCommentAfter.get(f.field_key);
                      return (
                        <Fragment key={f.field_key}>
                          <th>{f.field_label}</th>
                          {after && <th className={styles.colCommentHead}>{after.label}</th>}
                        </Fragment>
                      );
                    })}
                  </tr>

                  {/* Daily grid rows — always shows every day of the month, like the paper template */}
                  {Array.from({ length: report.daysInMonth || 0 }, (_, i) => i + 1).map((day) => {
                    const iso = `${yearMonth}-${String(day).padStart(2, "0")}`;
                    const dayRow = dayRowByDate.get(iso);
                    const values = dayRow?.values || {};
                    const weekday =
                      values.youbi?.value ?? values.youbi ?? WEEKDAY_JA[new Date(`${iso}T00:00:00`).getDay()];
                    // Editable cells: everything from 配食者名 on, except
                    // 利用者確認印 (its ○ comes from the day's photos).
                    const deliveryCell = editableCell(iso, "delivery_person", "value");
                    const uketoriCell = editableCell(iso, "uketori", "value");
                    const uketoriCommentCell = editableCell(iso, "uketori", "comment");
                    return (
                      <tr key={iso}>
                        <td className={styles.colDay}>{day}</td>
                        <td className={styles.colWeekday}>{weekday}</td>
                        <td
                          className={`${styles.colHaitatsusha} ${deliveryCell.className}`}
                          title={deliveryCell.title}
                          onClick={deliveryCell.onClick}
                        >
                          {deliveryCell.isEditing ? cellEditor() : textWithComment(values.delivery_person)}
                        </td>
                        <td className={styles.colKakuninin}>
                          {photoDateSet.has(iso) && <span className={styles.kakuninMark}>○</span>}
                        </td>
                        <td
                          className={`${styles.colUketori} ${uketoriCell.className}`}
                          title={uketoriCell.title}
                          onClick={uketoriCell.onClick}
                        >
                          {uketoriCell.isEditing ? cellEditor() : String(rawValue(values.uketori))}
                        </td>
                        <td
                          className={`${styles.colUketori} ${styles.colComment} ${uketoriCommentCell.className}`}
                          title={uketoriCommentCell.title}
                          onClick={uketoriCommentCell.onClick}
                        >
                          {uketoriCommentCell.isEditing ? cellEditor() : <CommentText text={rawComment(values.uketori)} />}
                        </td>
                        {orderedDailyBody.map((f) => {
                          const after = groupCommentAfter.get(f.field_key);
                          const isCheckbox = f.field_type === "checkbox";
                          const cell = editableCell(iso, f.field_key, "value", {
                            checkbox: isCheckbox,
                            numeric: f.field_type === "number",
                          });
                          const commentCell = after ? editableCell(iso, after.commentKey, "comment") : null;
                          return (
                            <Fragment key={f.field_key}>
                              <td
                                className={`${groupColClass(styles, FIELD_GROUP[f.field_key])} ${cell.className}`}
                                title={cell.title}
                                onClick={cell.onClick}
                              >
                                {isCheckbox ? (
                                  isChecked(values[f.field_key]) ? (
                                    <span className={styles.checkMark}>✓</span>
                                  ) : (
                                    ""
                                  )
                                ) : cell.isEditing ? (
                                  cellEditor()
                                ) : (
                                  textWithComment(values[f.field_key])
                                )}
                              </td>
                              {after && commentCell && (
                                <td
                                  className={`${groupColClass(styles, after.group)} ${styles.colComment} ${commentCell.className}`}
                                  title={commentCell.title}
                                  onClick={commentCell.onClick}
                                >
                                  {commentCell.isEditing ? (
                                    cellEditor()
                                  ) : (
                                    <CommentText text={rawComment(values[after.commentKey])} />
                                  )}
                                </td>
                              )}
                            </Fragment>
                          );
                        })}
                      </tr>
                    );
                  })}

                  {/* 月次報告欄 */}
                  <tr>
                    <td colSpan={totalCols} className={styles.sectionBar}>
                      月次報告欄
                    </td>
                  </tr>
                  <tr className={styles.headerRow}>
                    <th colSpan={2}>分類</th>
                    <th colSpan={4}>確認項目</th>
                    <th colSpan={2}>件数</th>
                    <th colSpan={commentColSpan}>
                      報告書コメント欄｜該当するものに✓＋必要時のみ一言
                    </th>
                  </tr>
                  {commentRowPlan.map((slot, idx) => {
                    // Rows past the tally list (more blocks than tally rows) have empty tally cells.
                    const tally = tallyRowKeys[idx];
                    const [group, key] = tally || ["", ""];
                    const label = tally ? dfByKey[key]?.field_label || key : "";
                    const count = tally ? report.tallies?.[group]?.[key] ?? 0 : "";
                    return (
                      <tr key={tally ? key : `extra-${idx}`}>
                        <td
                          className={`${styles.tallyCategory} ${tally ? tallyCategoryClass(styles, group) : ""}`}
                          colSpan={2}
                        >
                          {group}
                        </td>
                        <td className={styles.valueCell} colSpan={4}>
                          {label}
                        </td>
                        <td className={tally ? styles.tallyCount : styles.valueCell} colSpan={2}>
                          {count}
                        </td>
                        {slot === "skip" ? null : (
                          <td
                            className={styles.commentCell}
                            colSpan={commentColSpan}
                            rowSpan={slot ? slot.span : 1}
                          >
                            {slot && (
                              <>
                                <div style={{ fontWeight: 700, marginBottom: 2 }}>
                                  {slot.block.numeral}
                                  {slot.block.title}
                                </div>
                                <Checklist
                                  field={optionsField(slot.block.fieldKey, slot.block.title, slot.block.options)}
                                  value={monthlyValues[slot.block.fieldKey]}
                                  onPick={(label, sel) => pickMonthlyOption(slot.block.fieldKey, label, sel)}
                                />
                                {slot.block.freeText.enabled && (
                                  <div className={`mt-1 ${styles.monthlyTextLine}`}>
                                    {slot.block.freeText.label}：
                                    {monthlyText(slot.block.freeText.fieldKey)}
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}

                  {/* 総評 */}
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      総評
                    </td>
                    <td className={styles.commentCell} colSpan={totalCols - 2}>
                      {monthlyText("sohyo")}
                    </td>
                  </tr>

                  {/* Footer (報告日 / 確認者 / … as set in マスター設定) */}
                  {footerRows.map((cells, r) => (
                    <tr key={`footer-${r}`}>
                      {cells.map(({ item, labelSpan, valueSpan }) => (
                        <Fragment key={item.fieldKey}>
                          <td className={styles.labelCell} colSpan={labelSpan}>
                            {item.label}
                          </td>
                          <td
                            className={`${styles.valueCell} ${item.type === "date" ? styles.dateCell : ""}`}
                            colSpan={valueSpan}
                          >
                            {footerValue(item)}
                          </td>
                        </Fragment>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Card.Body>
          </Card>
        )}
      </Container>

      <Modal show={showGallery} onHide={() => setShowGallery(false)} centered size="xl" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>
            写真一覧 {report?.patient?.name ? `｜${report.patient.name}` : ""}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {photoGroups.length === 0 ? (
            <p className={galleryStyles.galleryEmpty}>この月にアップロードされた写真はありません</p>
          ) : (
            photoGroups.map(([label, groupPhotos]) => (
              <div key={label} className={galleryStyles.galleryGroup}>
                <div className={galleryStyles.galleryGroupLabel}>{label}</div>
                <div className={galleryStyles.galleryGrid}>
                  {groupPhotos.map((photo) => (
                    <div
                      key={photo.id}
                      className={galleryStyles.galleryThumb}
                      role="button"
                      tabIndex={0}
                      onClick={() => setLightboxIndex(reportPhotos.findIndex((p) => p.id === photo.id))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setLightboxIndex(reportPhotos.findIndex((p) => p.id === photo.id));
                        }
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt={photo.original_filename || "写真"} loading="lazy" decoding="async" />
                      {photo.created_at && (
                        <span className={galleryStyles.galleryThumbTime}>{formatPhotoTimestamp(photo.created_at)}</span>
                      )}
                      <button
                        type="button"
                        className={galleryStyles.galleryThumbDelete}
                        aria-label="写真を削除"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteReportPhoto(photo);
                        }}
                        disabled={deletingPhotoId === photo.id}
                        title="削除"
                      >
                        {deletingPhotoId === photo.id ? (
                          <Spinner animation="border" size="sm" />
                        ) : (
                          <Trash size={12} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </Modal.Body>
      </Modal>

      {qrOpen && <QRScanner onScan={handleQrScan} onClose={() => setQrOpen(false)} />}

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={reportPhotos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onDelete={handleDeleteReportPhoto}
          deletingId={deletingPhotoId}
        />
      )}
    </Layout>
  );
}
