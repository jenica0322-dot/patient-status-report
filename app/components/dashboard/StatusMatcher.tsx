// app/components/dashboard/StatusMatcher.tsx
"use client";

import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import { MicFill, StopFill, CheckCircleFill, Circle, ChevronDown, ChatLeftText, CameraFill, QrCodeScan, Trash } from "react-bootstrap-icons";
import { Spinner } from "react-bootstrap";
import styles from "@/app/styles/StatusMatcher.module.css";
import {
  fetchStatusFields,
  saveStatusRecord,
  fetchStatusRecords,
  uploadStatusPhotos,
  StatusPhoto,
} from "@/app/lib/statusApi";
import { usePatient } from "@/app/context/PatientContext";
import { useAuth } from "@/app/context/AuthContext";
import { JaDateInput, JaMonthInput } from "@/app/components/JaDatePicker";
import PatientSelector from "@/app/components/dashboard/PatientSelector";
import PhotoLightbox from "@/app/components/dashboard/PhotoLightbox";
import CameraCapture from "@/app/components/dashboard/CameraCapture";
import QRScanner from "@/app/components/dashboard/QRScanner";
import { normalizeSpokenDigits, toHiragana } from "@/app/lib/voiceText";
import { findPatientByTargetUserId, parseTargetUserId } from "@/app/lib/qrTargetUser";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
    MediaRecorder: any;
  }
}

type FieldType = "text" | "checkbox" | "preset" | "number";

type Field = {
  field_key: string;
  field_label: string;
  field_type: FieldType;
  phrases: string[];
  order_index: number;
};

type Match = { option: string; percentage: number };

const SCREENS: { key: string; label: string }[] = [
  { key: "daily_status", label: "日次記録" },
  { key: "monthly_report", label: "月次報告" },
];

function levenshteinDistance(s1: string, s2: string): number {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  const costs = new Array(s2.length + 1);
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1))
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

const normalizeJa = (t: string) =>
  t
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/[．。､,，]/g, ".")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

function isLikelyPatientShortcut(text: string) {
  const normalized = normalizeJa(text);
  if (!normalized) return false;
  if (/^[0-9]{2,}$/.test(normalized)) return true;
  if (/^[ぁ-んー]{2,}$/.test(normalized)) return true;
  // Catches pat_id read as kanji numerals ("一二三") or with the conventional
  // "まる"/"れい" reading of 0 — neither of which is plain [0-9] or hiragana text.
  if (normalizeSpokenDigits(text).length >= 2) return true;
  return false;
}

// True when the whole utterance is a spoken ID — digits, kanji digits, or the
// まる/れい/ぜろ reading of 0 — and nothing else (at least 2 digits).
function isSpokenIdOnly(text: string) {
  const normalized = normalizeJa(text);
  if (!normalized) return false;
  const rest = toHiragana(normalized).replace(/まる|ぜろ|れい/g, "").replace(/[0-9０-９〇零一二三四五六七八九.ー-]/g, "");
  return rest === "" && normalizeSpokenDigits(text).length >= 2;
}

// Labels like "顔色/元気", "新聞/郵便", or "体調面・一言" join two spoken concepts with
// a slash or center-dot nobody actually says aloud, and continuous recognition often
// finalizes each half separately when the speaker pauses between them — so each half
// needs to be matchable on its own. The "・" case also covers the "<base>・一言"-style
// companion text fields (食事状況・一言, 体調面・一言, 日常サポート・一言, 共有事項・内容,
// 対応方針・方針), which are otherwise unreachable since nobody speaks "・" aloud.
function fieldMatchCandidates(label: string): string[] {
  const parts = label.split(/[\/／・]/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? [label, ...parts] : [label];
}

function bestFieldMatch(utterance: string, fields: Field[]): Field | null {
  const cleaned = normalizeJa(utterance);
  if (!cleaned) return null;
  let best: { f: Field; score: number } | null = null;
  for (const f of fields) {
    for (const candidate of fieldMatchCandidates(f.field_label)) {
      const cleanedCandidate = normalizeJa(candidate);
      if (!cleanedCandidate) continue;
      let sim: number;
      if (cleaned === cleanedCandidate) {
        // A verbatim match against this exact candidate always outranks a mere
        // substring hit inside a longer, unrelated field's label. Without this,
        // saying "対応方針" — an exact split-candidate of "対応方針・方針" — would
        // tie with it merely appearing inside "次月の対応方針" and always lose to
        // whichever field happens to come first in field order.
        sim = 100;
      } else if (
        cleaned.length >= 2 &&
        (cleanedCandidate.includes(cleaned) || cleaned.includes(cleanedCandidate))
      ) {
        // Partial word/segment match against a (possibly compound) label — e.g. saying
        // only "食欲" for "食欲低下", or "元気" for the "顔色/元気" candidate above.
        // Scored below an exact match (see above) so it never wins that tie-break.
        sim = 90;
      } else {
        const dist = levenshteinDistance(cleaned, cleanedCandidate);
        const maxLen = Math.max(cleaned.length, cleanedCandidate.length);
        sim = ((maxLen - dist) / maxLen) * 100;
      }
      if (!best || sim > best.score) best = { f, score: sim };
    }
  }
  return best && best.score >= 60 ? best.f : null;
}

const AFFIRMATIVE = /^(よし|した|できた|チェック|レ|まる|○|✓|ok|オーケー)$/;
const NEGATIVE = /^(なし|しない|できていない|ばつ|×|no)$/;

// Spellings the recognizer commonly produces for a clearly spoken 「よし」/「なし」
// (kanji, katakana, stretched vowels) — folded back to the hiragana form the
// answer regexes expect.
const YOSHI_VARIANTS = /^(良し|善し|好し|吉|止し|よーし|よしっ|よっし)$/;
const NASHI_VARIANTS = /^(無し|梨|無|なーし|なしっ)$/;

// Normalizes a short spoken answer before testing it against AFFIRMATIVE /
// NEGATIVE / CONFIRM_SAVE_*: drops trailing punctuation the recognizer
// appends ("よし。" → "よし."), and folds katakana ("ヨシ") and the common
// kanji/stretched variants above into よし/なし. Anything else is returned
// with its katakana intact, since "チェック"/"オーケー" are matched as-is.
function normalizeAnswer(t: string): string {
  const cleaned = normalizeJa(t).replace(/[.!！?？、…]+$/g, "");
  const hira = cleaned.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  if (hira === "よし" || YOSHI_VARIANTS.test(hira)) return "よし";
  if (hira === "なし" || NASHI_VARIANTS.test(hira)) return "なし";
  return cleaned;
}

// True for an utterance that is unambiguously a checkbox yes/no answer.
function isCheckboxAnswer(t: string): boolean {
  const a = normalizeAnswer(t);
  return AFFIRMATIVE.test(a) || NEGATIVE.test(a);
}
// "写真アップロード" covers the recognizer dropping the を particle; "写真追加"
// matches the visible button label so saying what's on screen also works.
const PHOTO_UPLOAD_COMMAND = /^(写真を?アップロード|アップロード写真|写真追加|uploadphoto|photoupload)$/;
const PATIENT_SELECT_FIELD_LABEL = "利用者選択";

// Answers to the sequential flow's final "保存しますか？" confirmation. Distinct
// from AFFIRMATIVE/NEGATIVE above (those are per-field "did this happen"
// checkbox answers) — this is a plain yes/no to a yes/no question, so it
// accepts the words people actually say to that ("はい"/"いいえ") too.
const CONFIRM_SAVE_YES = /^(はい|うん|お願いします|する|よし|オーケー|ok|保存|ほぞん|save)$/;
const CONFIRM_SAVE_NO = /^(いいえ|いや|しない|やめる|キャンセル|no)$/;

// Field groups where the fields represent mutually exclusive states of one
// underlying question (e.g. a meal was 完食/半分/残し — finished, half-eaten,
// or leftover — never more than one of those at once). Once any field in a
// group has been answered "true", the sequential auto-flow skips straight
// past the rest of the group instead of asking about states that no longer
// apply.
const MUTUALLY_EXCLUSIVE_FIELD_GROUPS: string[][] = [
  ["kanshoku", "hanbun", "nokoshi"], // 完食 / 半分 / 残し
];

// Click choices shown for うけとり in place of its stored phrases. The chosen
// label itself is what gets saved to the uketori field.
const UKETORI_OPTIONS = ["玄関", "家族", "不在"];

// Picker-only Target Fields that sit in front of an existing report column group
// and save into those columns. Picking an option sets its own column and clears
// whatever another option in the same picker had set, so only the final choice
// stays in the report. `next` shows a follow-up choice instead of saving.
// `multiple` pickers instead toggle each option on/off independently and only
// move on to the next Target Field when 次へ is said.
type GroupOption = { label: string; key?: string; value?: any; next?: GroupOption[] };
type GroupTargetField = { field_key: string; field_label: string; anchorKey: string; options: GroupOption[]; multiple?: boolean };

const GROUP_TARGET_FIELDS: GroupTargetField[] = [
  {
    field_key: "__tabenokoshi",
    field_label: "食べ残し",
    anchorKey: "kanshoku",
    options: [
      { label: "なし", key: "kanshoku", value: true },
      { label: "半分", key: "hanbun", value: true },
      { label: "あり", key: "nokoshi", value: true },
    ],
  },
  {
    field_key: "__taicho",
    field_label: "体調",
    anchorKey: "shokuyoku_teika",
    multiple: true,
    options: [
      { label: "食欲低下", key: "shokuyoku_teika", value: true },
      { label: "顔色・元気", key: "kaoiro_genki", value: true },
      { label: "ふらつき", key: "furatsuki", value: true },
      { label: "体調他", next: [{ label: "風邪", key: "taicho_ta", value: "風邪" }] },
    ],
  },
];

// Target Field dropdown entries: only うけとり and the picker-only group fields
// (食べ残し / 体調), each group placed where its first column sits.
function buildPickerFields(fields: Field[]): (Field | GroupTargetField)[] {
  return fields.flatMap((f): (Field | GroupTargetField)[] => {
    const group = GROUP_TARGET_FIELDS.find((g) => g.anchorKey === f.field_key);
    if (group) return [group];
    return f.field_key === "uketori" ? [f] : [];
  });
}

function groupLeafOptions(options: GroupOption[]): GroupOption[] {
  return options.flatMap((o) => (o.next ? groupLeafOptions(o.next) : [o]));
}

// Spoken "done with this field" for a `multiple` picker (体調).
const NEXT_FIELD_COMMAND = /^(次|つぎ|次へ|つぎへ|以上|いじょう|next)$/;

// Every choice a picker-only Target Field shows, including follow-up choices
// (体調他 → 風邪), so a spoken answer can be matched against any of them.
function groupAllOptions(options: GroupOption[]): GroupOption[] {
  return options.flatMap((o) => (o.next ? [o, ...groupAllOptions(o.next)] : [o]));
}

// Matches a spoken answer to one of the choices shown for the active Target
// Field — exact (normalized) first, otherwise the closest choice that's still
// clearly similar. Returns null when nothing is close enough.
function matchChoice(utterance: string, choices: string[]): string | null {
  const cleaned = normalizeJa(utterance);
  if (!cleaned) return null;
  let best: { choice: string; score: number } | null = null;
  for (const choice of choices) {
    const cleanedChoice = normalizeJa(choice);
    if (!cleanedChoice) continue;
    if (cleaned === cleanedChoice) return choice;
    const dist = levenshteinDistance(cleaned, cleanedChoice);
    const maxLen = Math.max(cleaned.length, cleanedChoice.length);
    const sim = ((maxLen - dist) / maxLen) * 100;
    if (!best || sim > best.score) best = { choice, score: sim };
  }
  return best && best.score >= 60 ? best.choice : null;
}

function isGroupOptionSelected(option: GroupOption, values: Record<string, { value?: any; comment?: string }>): boolean {
  if (option.next) return option.next.some((n) => isGroupOptionSelected(n, values));
  return !!option.key && values[option.key]?.value === option.value;
}

function shouldSkipInAutoFlow(field: Pick<Field, "field_key" | "field_label">, values: Record<string, { value?: any; comment?: string }>) {
  // 利用者選択 exists so a patient can be picked as one of the Target Fields,
  // but the auto-flow only ever starts after a patient is already selected
  // (by QR, voice, or manual pick), so asking it again makes no sense here.
  if (field.field_label === PATIENT_SELECT_FIELD_LABEL) return true;
  const group = MUTUALLY_EXCLUSIVE_FIELD_GROUPS.find((g) => g.includes(field.field_key));
  if (!group) return false;
  return group.some((key) => key !== field.field_key && values[key]?.value === true);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toYearMonth(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// Recognizes a spoken date and resolves it to both an ISO date (for the daily
// 記録日 field) and a year-month (for the monthly 対象年月 field) — the caller
// picks whichever applies to the screen currently in view. Only matches when the
// ENTIRE utterance is date-shaped (anchored regexes), so it can't misfire on a
// sentence that merely contains a date-like fragment partway through.
function parseSpokenDate(utterance: string): { date?: string; month?: string } | null {
  const cleaned = normalizeJa(utterance);
  if (!cleaned) return null;

  const today = new Date();
  if (/^(今日|本日|きょう)$/.test(cleaned)) {
    return { date: toIsoDate(today), month: toYearMonth(today) };
  }
  if (/^(昨日|さくじつ|きのう)$/.test(cleaned)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return { date: toIsoDate(d), month: toYearMonth(d) };
  }
  if (/^(明日|あした|あす)$/.test(cleaned)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return { date: toIsoDate(d), month: toYearMonth(d) };
  }

  // "2026年8月6日" / "8月6日" (year defaults to the current year when omitted).
  let m = cleaned.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    const year = m[1] ? Number(m[1]) : today.getFullYear();
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { date: `${year}-${pad2(month)}-${pad2(day)}`, month: `${year}-${pad2(month)}` };
  }

  // "2026年8月" / "8月" — month-only, mainly for the 対象年月 field.
  m = cleaned.match(/^(?:(\d{4})年)?(\d{1,2})月$/);
  if (m) {
    const year = m[1] ? Number(m[1]) : today.getFullYear();
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return { month: `${year}-${pad2(month)}` };
  }

  return null;
}

async function canRecordMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !navigator.mediaDevices?.getUserMedia) {
    alert("このブラウザは音声認識に対応していません。手入力をご利用ください。");
    return false;
  }
  try {
    const perm = (navigator as any).permissions?.query
      ? await (navigator as any).permissions.query({ name: "microphone" as any })
      : null;
    if (perm && perm.state === "denied") {
      alert("マイクへのアクセスが拒否されています。ブラウザのサイト設定で許可してください。");
      return false;
    }
  } catch {}
  return true;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function StatusMatcher() {
  const { selectedPatient, selectPatient } = usePatient();
  const { user } = useAuth();

  const [screenKey, setScreenKey] = useState<string>("daily_status");
  const [recordDate, setRecordDate] = useState(todayIso());
  const [yearMonth, setYearMonth] = useState(currentYearMonth());

  const [fields, setFields] = useState<Field[]>([]);
  const [focusKey, setFocusKey] = useState<string>("");
  const [values, setValues] = useState<Record<string, { value?: any; comment?: string }>>({});
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [matchStatus, setMatchStatus] = useState<"none" | "match" | "no-match">("none");
  const [matches, setMatches] = useState<Match[]>([]);
  const [manualText, setManualText] = useState("");
  const [patientVoiceText, setPatientVoiceText] = useState("");
  const [patientVoiceRequestId, setPatientVoiceRequestId] = useState(0);
  // Covers both the Target Field voice match (synchronous) and the Target
  // Users voice search (async, resolved via PatientSelector's onExternalVoiceResult) —
  // the mic stays disabled for the duration of whichever is in flight.
  const [isSearching, setIsSearching] = useState(false);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  // Selected but not yet uploaded — local object URLs only, discarded unless 保存 is pressed.
  const [pendingPhotos, setPendingPhotos] = useState<{ id: number; file: File; url: string }[]>([]);
  const [savingRecord, setSavingRecord] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  // Drives the "保存しますか？" yes/no UI at the end of the sequential auto-flow.
  const [awaitingSaveConfirm, setAwaitingSaveConfirm] = useState(false);

  const fieldMenuRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPhotosRef = useRef(pendingPhotos);
  const pendingIdRef = useRef(0);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const lastFinalRef = useRef<string>("");
  const focusKeyRef = useRef<string>("");
  const valuesRef = useRef<Record<string, { value?: any; comment?: string }>>({});
  const patientFieldVoiceKeyRef = useRef<string | null>(null);
  // A long-lived recognition session's onresult closure can outlive several renders
  // (see createRecognition/restartRecognition), so screenKey must be read through a
  // ref — same reason focusKey/values are — otherwise a voice-spoken date after
  // switching 日次記録/月次報告 while still listening would apply to the wrong field.
  const screenKeyRef = useRef<string>(screenKey);
  // handleSaveRecord is reachable from that same stale closure via the spoken "保存"
  // command, so it needs its own fresh reads too — otherwise saying a date command
  // ("8月6日") and then "保存" in one listening session saves under the date/patient
  // that was current when recognition started, not the one just set, and the record
  // silently lands on the wrong day/month and never shows up in the report.
  const selectedPatientRef = useRef(selectedPatient);
  const recordDateRef = useRef(recordDate);
  const yearMonthRef = useRef(yearMonth);
  // Sequential auto-flow phase: "off" (manual, existing behavior) | "field"
  // (auto-asking Target Fields in order) | "confirm-save" (asking the final
  // 保存しますか？ yes/no). A ref because handleFinalTranscript's long-lived
  // recognition closure needs the current value, not the one at mount.
  const flowPhaseRef = useRef<"off" | "field" | "confirm-save">("off");
  // Skips starting the auto-flow for a patient already selected when this
  // screen mounts/reloads (e.g. restored from localStorage) — it should only
  // kick in the moment a patient is newly selected during this session.
  const patientFlowMountedRef = useRef(false);
  // How the next patient selection is being made. Set just before a QR scan,
  // voice search or manual pick from the list selects a patient; anything
  // else (e.g. the patient restored from localStorage on reload) leaves it
  // null. Only these user selections start the auto-flow.
  const patientSelectSourceRef = useRef<"qr" | "voice" | "manual" | null>(null);

  useEffect(() => {
    focusKeyRef.current = focusKey;
  }, [focusKey]);

  useEffect(() => {
    screenKeyRef.current = screenKey;
  }, [screenKey]);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    selectedPatientRef.current = selectedPatient;
  }, [selectedPatient]);

  useEffect(() => {
    recordDateRef.current = recordDate;
  }, [recordDate]);

  useEffect(() => {
    yearMonthRef.current = yearMonth;
  }, [yearMonth]);

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);

  // Revoke any still-unsaved preview URLs on unmount so they don't leak.
  useEffect(() => {
    return () => {
      pendingPhotosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, []);

  // Load master fields whenever the screen changes.
  useEffect(() => {
    (async () => {
      const rows = await fetchStatusFields(screenKey);
      setFields(rows);
      // Start on the first Target Field entry (うけとり) rather than the first
      // master row (利用者選択); screens without entries keep the first row.
      const firstPicker = buildPickerFields(rows)[0];
      if (firstPicker) setFocusKey(firstPicker.field_key);
      else if (rows.length) setFocusKey(rows[0].field_key);
      setManualText("");
    })();
  }, [screenKey]);

  // Load any already-saved record for this patient + date/month, so re-visiting edits instead of starting blank.
  useEffect(() => {
    if (!selectedPatient) return;
    (async () => {
      try {
        const params =
          screenKey === "daily_status"
            ? { screen_key: screenKey, patient_id: selectedPatient.id, from: recordDate, to: recordDate }
            : { screen_key: screenKey, patient_id: selectedPatient.id, record_year_month: yearMonth };
        const rows = await fetchStatusRecords(params);
        setValues(rows[0]?.values || {});
      } catch (e) {
        console.error("failed to load existing record", e);
        setValues({});
      }
    })();
  }, [selectedPatient, screenKey, recordDate, yearMonth]);

  // Switching patient/date/screen discards any not-yet-saved previews — they
  // were staged for whichever record was showing when they were picked.
  useEffect(() => {
    pendingPhotosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPendingPhotos([]);
  }, [selectedPatient, screenKey, recordDate, yearMonth]);

  // Kicks off the sequential Target Field auto-flow the moment a patient is
  // newly selected by QR scan, voice search or a manual pick from the list —
  // but not for a patient already selected when this screen first
  // mounts/reloads.
  useEffect(() => {
    const source = patientSelectSourceRef.current;
    patientSelectSourceRef.current = null;
    if (!patientFlowMountedRef.current) {
      patientFlowMountedRef.current = true;
      return;
    }
    if (!selectedPatient) return;
    if (source) {
      startAutoFlow();
    } else {
      // Selected some other way (e.g. restored after reload): end any
      // auto-flow still running for the previous patient, so its questions
      // don't carry on for this one. The mic is left as it is.
      const wasActive = flowPhaseRef.current !== "off";
      flowPhaseRef.current = "off";
      setAwaitingSaveConfirm(false);
      if (wasActive && typeof window !== "undefined") window.speechSynthesis?.cancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient?.id]);

  // The strip here is a staging area only — once 保存 uploads them they're
  // dropped from view immediately after. 対象フィールド has no photo history of
  // its own; 報告書's 写真を見る is the only place saved photos are browsed.
  const pendingDisplay = useMemo<StatusPhoto[]>(
    () =>
      pendingPhotos.map((p) => ({
        id: p.id,
        url: p.url,
        original_filename: p.file.name,
      })),
    [pendingPhotos]
  );

  // 写真追加 goes straight to the camera; the file picker is only the fallback
  // CameraCapture offers when the camera can't be opened.
  const handlePhotoButtonClick = () => setCameraOpen(true);

  // Scans a Target User QR code, reads the Target User ID off it, and selects
  // that patient the same way a voice/manual pick does.
  const handleQrScan = async (raw: string) => {
    setQrOpen(false);
    const targetUserId = parseTargetUserId(raw);
    if (!targetUserId) {
      setStatusMsg("❌ QRコードから利用者IDを読み取れませんでした");
      return;
    }
    setIsSearching(true);
    try {
      const patient = await findPatientByTargetUserId(targetUserId);
      if (patient) {
        // Re-scanning the patient already selected doesn't change the
        // selection, so don't leave a "qr" mark for a later manual pick.
        if (patient.id !== selectedPatientRef.current?.id) patientSelectSourceRef.current = "qr";
        selectPatient(patient);
        setStatusMsg(`✅ ${patient.name} を選択しました`);
      } else {
        setStatusMsg(`❌ ID ${targetUserId} の利用者が見つかりませんでした`);
      }
    } catch (e) {
      console.error("QR patient lookup failed", e);
      setStatusMsg("❌ 利用者の検索に失敗しました");
    } finally {
      setIsSearching(false);
    }
  };

  const handlePickFromFile = () => {
    setCameraOpen(false);
    photoInputRef.current?.click();
  };

  // Only one photo per patient per day is kept, so a new one replaces whatever
  // was already staged rather than adding to it. Takes ownership of `url`.
  const stagePhoto = (file: File, url: string) => {
    pendingIdRef.current -= 1;
    const item = { id: pendingIdRef.current, file, url };
    setPendingPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [item];
    });
  };

  // Confirmed in the camera's review step — staged as a local preview only;
  // nothing is sent to the server until 保存 is pressed.
  const handleCameraConfirm = (file: File) => {
    stagePhoto(file, URL.createObjectURL(file));
    setCameraOpen(false);
    setStatusMsg("📷 写真を追加しました（保存でアップロード）");
  };

  const handlePhotoFilesSelected = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    stagePhoto(file, URL.createObjectURL(file));
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const handleRemovePendingPhoto = (photo: StatusPhoto) => {
    setPendingPhotos((prev) => {
      const target = prev.find((p) => p.id === photo.id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== photo.id);
    });
    setLightboxIndex((idx) => {
      if (idx === null) return idx;
      const remaining = pendingPhotos.filter((p) => p.id !== photo.id);
      if (remaining.length === 0) return null;
      return Math.min(idx, remaining.length - 1);
    });
  };

  const focusField = useMemo(
    () => fields.find((f) => f.field_key === focusKey),
    [fields, focusKey]
  );
  const isPatientSelectField = focusField?.field_label === PATIENT_SELECT_FIELD_LABEL;
  const focusGroupField = useMemo(
    () => GROUP_TARGET_FIELDS.find((g) => g.field_key === focusKey),
    [focusKey]
  );
  const pickerFields = useMemo(() => buildPickerFields(fields), [fields]);
  // Where the comment box reads/writes for the focused Target Field. Picker-only
  // fields (食べ残し / 体調) have no column of their own, so their comment goes
  // on the report column they sit in front of.
  const commentKey = focusGroupField ? focusGroupField.anchorKey : focusField?.field_key;
  // 保存 is only shown once every Target Field has an answer (skipped ones
  // don't count). A `multiple` picker (体調) may legitimately be left empty,
  // so it never holds this back. Screens without Target Fields always show it.
  const allTargetFieldsAnswered = useMemo(
    () =>
      pickerFields.every((f) => {
        if (shouldSkipInAutoFlow(f, values)) return true;
        const group = GROUP_TARGET_FIELDS.find((g) => g.field_key === f.field_key);
        if (group) return !!group.multiple || groupLeafOptions(group.options).some((o) => isGroupOptionSelected(o, values));
        const v = values[f.field_key]?.value;
        return v !== undefined && v !== null && v !== "";
      }),
    [pickerFields, values]
  );
  // Which group option (e.g. 体調他) currently has its follow-up choices open.
  const [openGroupOption, setOpenGroupOption] = useState<string | null>(null);

  // Saves the record in the background right after a Target Field choice is
  // clicked, so the Report reflects it without waiting for 保存. Saves run one
  // after another so a quick second click can't be overwritten by the first.
  // Photos are still only uploaded by 保存.
  const autoSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const autoSaveSelection = (nextValues: Record<string, { value?: any; comment?: string }>) => {
    const patient = selectedPatientRef.current;
    if (!patient) return;
    const screen = screenKeyRef.current;
    const baseParams =
      screen === "daily_status"
        ? { screen_key: screen, patient_id: patient.id, record_date: recordDateRef.current }
        : { screen_key: screen, patient_id: patient.id, record_year_month: yearMonthRef.current };
    const payloadValues =
      screen === "daily_status"
        ? { ...nextValues, delivery_person: { value: user?.username || "" } }
        : nextValues;
    autoSaveChainRef.current = autoSaveChainRef.current
      .then(() => saveStatusRecord({ ...baseParams, values: payloadValues }))
      .then(
        () => {},
        (e) => console.error("auto-save failed", e)
      );
  };

  // `replace` (used for voice answers) clears the field's previous selection
  // first so only the newly spoken option remains — even on a `multiple`
  // picker, where a tap toggles options individually instead.
  const selectGroupOption = (group: GroupTargetField, option: GroupOption, replace = false) => {
    if (option.next) {
      setOpenGroupOption(option.label);
      return;
    }
    const v = valuesRef.current;
    const next = { ...v };
    if (group.multiple && !replace) {
      const wasSelected = isGroupOptionSelected(option, v);
      next[option.key!] = {
        ...(v[option.key!] || {}),
        value: wasSelected ? (option.value === true ? false : "") : option.value,
      };
      valuesRef.current = next;
      setValues(next);
      autoSaveSelection(next);
      setStatusMsg(
        `${group.field_label}: 「${option.label}」を${wasSelected ? "外しました" : "記録しました"}（複数選択可）`
      );
      return;
    }
    for (const leaf of groupLeafOptions(group.options)) {
      if (!leaf.key || leaf.key === option.key) continue;
      if (v[leaf.key]?.value === leaf.value) {
        next[leaf.key] = { ...(v[leaf.key] || {}), value: leaf.value === true ? false : "" };
      }
    }
    next[option.key!] = { ...(v[option.key!] || {}), value: option.value };
    valuesRef.current = next;
    setValues(next);
    autoSaveSelection(next);
    setStatusMsg(`${group.field_label}: 「${option.label}」を記録しました`);
  };

  useEffect(() => {
    setManualText(String(values[focusKey]?.value ?? ""));
    setFieldMenuOpen(false);
    setOpenGroupOption(null);
  }, [focusKey]);

  useEffect(() => {
    if (!fieldMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (fieldMenuRef.current && !fieldMenuRef.current.contains(e.target as Node)) {
        setFieldMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [fieldMenuOpen]);

  // On unmount (e.g. navigating away to another screen while still listening),
  // detach the handlers before stopping — otherwise the old instance's onend
  // fires after unmount and, since isListeningRef still reads true, restarts
  // itself in the background. That zombie session then occupies the browser's
  // single speech-recognition slot forever, so the next time this screen mounts
  // and the user presses the mic, start() silently fails with nothing listening.
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        rec.onend = null;
        rec.onerror = null;
        rec.onresult = null;
        try {
          rec.stop();
        } catch {}
      }
      isListeningRef.current = false;
    };
  }, []);

  // Builds a fresh recognition instance rather than reusing one that just ended —
  // some browsers throw InvalidStateError when start() is called again on the same
  // instance too soon after onend, which used to silently kill voice input for good
  // (most noticeably right after saying/clicking "保存", the natural pause point).
  const createRecognition = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "ja-JP";
    // Extra hypotheses let a short yes/no answer ("よし"/"なし") still be
    // picked up when the recognizer's top guess is a homophone — see
    // pickAnswerAlternative. The top guess ([0]) is unchanged.
    rec.maxAlternatives = 5;

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) {
          const alternatives: string[] = [];
          for (let j = 1; j < e.results[i].length; j++) {
            const alt = e.results[i][j]?.transcript?.trim();
            if (alt) alternatives.push(alt);
          }
          handleFinalTranscript(chunk, alternatives);
        } else interim += chunk;
      }
      setTranscript(interim);
    };

    // The browser ended this session on its own (e.g. after a pause in speech) —
    // it's already fully torn down at this point, so it's safe to start a new one.
    rec.onend = () => {
      if (isListeningRef.current) startFreshRecognition();
    };
    rec.onerror = (ev: any) => {
      console.warn("Speech error:", ev?.error);
      // "no-speech" fires routinely during pauses; onend already restarts listening, so ignore it.
      if (ev?.error === "no-speech" || ev?.error === "aborted") return;

      const ERROR_MESSAGES: Record<string, string> = {
        "not-allowed": "マイクへのアクセスが拒否されました。ブラウザのサイト設定で許可してください。",
        "service-not-allowed": "マイクへのアクセスが拒否されました。ブラウザのサイト設定で許可してください。",
        "audio-capture": "マイクを利用できませんでした。他のアプリがマイクを使用していないか確認してください。",
        network: "音声認識サーバーに接続できませんでした。ネットワーク接続を確認してください。",
      };
      stopAll();
      setStatusMsg(`❌ ${ERROR_MESSAGES[ev?.error] || "音声認識でエラーが発生しました"}`);
    };

    return rec;
  };

  const startFreshRecognition = () => {
    if (!isListeningRef.current) return;
    try {
      recognitionRef.current = createRecognition();
      recognitionRef.current.start();
    } catch (err) {
      console.warn("voice restart failed:", err);
    }
  };

  // Explicitly retires whatever recognition instance is currently active and
  // starts a brand-new one — but only once the browser confirms the old session
  // is actually closed (via its onend), rather than guessing with a timer. Used
  // after save so voice input can't be left stranded by a session the browser
  // silently ended out from under us while the save was in flight.
  const restartRecognition = () => {
    const old = recognitionRef.current;
    if (!old) {
      startFreshRecognition();
      return;
    }
    old.onresult = null;
    old.onerror = null;
    old.onend = () => startFreshRecognition();
    try {
      old.stop();
    } catch {
      startFreshRecognition();
    }
  };

  const handleStartListening = async () => {
    if (isListeningRef.current || isSearching) return;
    if (!(await canRecordMic())) return;

    setTranscript("");
    setStatusMsg("");
    setMatchStatus("none");
    setMatches([]);

    try {
      recognitionRef.current = createRecognition();
      recognitionRef.current.start();
      setIsListening(true);
      isListeningRef.current = true;
    } catch (err: any) {
      console.error("SpeechRecognition start error:", err);
      alert("マイクを開始できませんでした。");
      stopAll();
    }
  };

  function stopAll() {
    try {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    } finally {
      isListeningRef.current = false;
      setIsListening(false);
    }
  }

  const handleStopListening = () => stopAll();

  const setFieldValue = (key: string, value: any) => {
    setValues((v) => ({ ...v, [key]: { ...(v[key] || {}), value } }));
  };

  // Speaks a prompt aloud, then resumes the mic once it's done (used for both
  // the per-field question and the final save confirmation). Recognition is
  // paused for the duration of the speech — otherwise it can hear the app's
  // own TTS voice come back through the speaker and mistake it for an answer.
  const speak = (text: string) => {
    const resumeListening = () => {
      if (flowPhaseRef.current !== "off") handleStartListening();
    };
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) {
      resumeListening();
      return;
    }
    if (isListeningRef.current) stopAll();
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.onend = resumeListening;
    utter.onerror = resumeListening;
    synth.speak(utter);
  };

  // Moves the auto-flow to `field`: focuses it, resets the per-answer match
  // state, and asks the question by voice (which also (re)starts the mic).
  const goToField = (field: Field | GroupTargetField) => {
    setFocusKey(field.field_key);
    focusKeyRef.current = field.field_key;
    // A new question expects a new answer — clear the duplicate-final guard
    // so answering "よし" again (same as the previous field) isn't dropped.
    lastFinalRef.current = "";
    setMatchStatus("none");
    setMatches([]);
    setStatusMsg(`➡ ${field.field_label} を確認します`);
    speak(`${field.field_label}を教えてください`);
  };

  // Asks the final "保存しますか？" once every Target Field has been answered.
  const promptSaveConfirm = () => {
    flowPhaseRef.current = "confirm-save";
    lastFinalRef.current = "";
    setAwaitingSaveConfirm(true);
    setStatusMsg("💾 保存しますか？");
    speak("保存しますか？");
  };

  // Called right after `fromKey` has been answered (by voice or by tapping a
  // choice on screen) while the auto-flow is active — advances to the next
  // not-skipped field, or asks to save if that was the last one.
  // `valuesSnapshot` lets the caller pass the value it just set explicitly,
  // since `values`/`valuesRef` may not have committed that update yet by the
  // time this runs (needed so a same-tick mutually-exclusive-group skip sees
  // the answer that was just given, not the one from before it).
  const advanceFlow = (fromKey: string, valuesSnapshot?: Record<string, { value?: any; comment?: string }>) => {
    if (flowPhaseRef.current !== "field") return;
    if (focusKeyRef.current !== fromKey) return;
    const snapshot = valuesSnapshot ?? valuesRef.current;
    const idx = pickerFields.findIndex((f) => f.field_key === fromKey);
    if (idx === -1) return;
    let next: Field | GroupTargetField | undefined;
    for (let i = idx + 1; i < pickerFields.length; i++) {
      if (!shouldSkipInAutoFlow(pickerFields[i], snapshot)) {
        next = pickerFields[i];
        break;
      }
    }
    if (next) {
      goToField(next);
    } else {
      promptSaveConfirm();
    }
  };

  // 次へ (said on 体調): inside the auto-flow, advance as usual (which
  // asks the next question by voice); otherwise just move focus to the next
  // Target Field entry.
  const proceedToNextTargetField = (fromKey: string, valuesSnapshot?: Record<string, { value?: any; comment?: string }>) => {
    if (flowPhaseRef.current === "field") {
      advanceFlow(fromKey, valuesSnapshot);
      return;
    }
    if (focusKeyRef.current !== fromKey) return;
    const idx = pickerFields.findIndex((f) => f.field_key === fromKey);
    const next = idx === -1 ? undefined : pickerFields[idx + 1];
    if (!next) return;
    setFocusKey(next.field_key);
    focusKeyRef.current = next.field_key;
  };

  // Ends the voice-question flow once 保存しますか？ is answered (はい or いいえ):
  // stops the mic right away and keeps anything still in flight — pending TTS,
  // or a trailing result from the session being stopped — from asking again
  // or being read as a new command.
  const endVoiceFlow = () => {
    setAwaitingSaveConfirm(false);
    flowPhaseRef.current = "off";
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    if (recognitionRef.current) recognitionRef.current.onresult = null;
    stopAll();
  };

  const confirmSaveYes = async () => {
    // Stopped before saving, so handleSaveRecord's restart-on-save (for the
    // ordinary manual "保存" command/button) sees the mic off and skips it.
    endVoiceFlow();
    await handleSaveRecord();
  };

  const confirmSaveNo = () => {
    endVoiceFlow();
    setStatusMsg("保存をキャンセルしました");
  };

  // Starts the sequential Target Field auto-flow from the first not-skipped
  // Target Field entry (same entries, same order as the 対象フィールド dropdown)
  // — called once a patient is newly selected (QR/voice/manual pick).
  const startAutoFlow = () => {
    if (!pickerFields.length) return;
    flowPhaseRef.current = "field";
    setAwaitingSaveConfirm(false);
    const first = pickerFields.find((f) => !shouldSkipInAutoFlow(f, valuesRef.current));
    if (!first) return;
    goToField(first);
  };

  const checkMatchAgainstPhrases = (text: string, phrases: string[], targetKey: string) => {
    const cleanedTranscript = normalizeJa(text);
    if (!cleanedTranscript) {
      setMatchStatus("none");
      setMatches([]);
      return;
    }

    let allMatches: Match[] = [];
    let best: Match = { option: "", percentage: 0 };
    const MATCH_THRESHOLD = 40.0;

    for (const option of phrases) {
      const cleanedOption = normalizeJa(option);
      if (!cleanedOption) continue;
      const dist = levenshteinDistance(cleanedTranscript, cleanedOption);
      const maxLen = Math.max(cleanedTranscript.length, cleanedOption.length);
      const sim = ((maxLen - dist) / maxLen) * 100;
      if (sim >= MATCH_THRESHOLD) {
        const m = { option, percentage: sim };
        allMatches.push(m);
        if (sim > best.percentage) best = m;
      }
    }

    allMatches.sort((a, b) => b.percentage - a.percentage);
    setMatches(allMatches);

    if (best.percentage > 0) {
      setMatchStatus("match");
      setFieldValue(targetKey, best.option);
      setStatusMsg(`「${best.option}」を記録しました`);
      advanceFlow(targetKey, { ...valuesRef.current, [targetKey]: { ...(valuesRef.current[targetKey] || {}), value: best.option } });
    } else {
      setMatchStatus("no-match");
      setStatusMsg("候補に一致しませんでした");
    }
  };

  // Applies a checkbox answer ("よし"/"なし" etc.) to `field`, advancing the flow.
  const answerCheckbox = (field: Field, rawFinal: string) => {
    const currentKey = field.field_key;
    const cleaned = normalizeAnswer(rawFinal);
    if (AFFIRMATIVE.test(cleaned) || normalizeJa(rawFinal) === normalizeJa(field.field_label)) {
      setFieldValue(currentKey, true);
      setStatusMsg(`${field.field_label}: チェックしました`);
      advanceFlow(currentKey, { ...valuesRef.current, [currentKey]: { ...(valuesRef.current[currentKey] || {}), value: true } });
    } else if (NEGATIVE.test(cleaned)) {
      setFieldValue(currentKey, false);
      setStatusMsg(`${field.field_label}: チェックを外しました`);
      advanceFlow(currentKey, { ...valuesRef.current, [currentKey]: { ...(valuesRef.current[currentKey] || {}), value: false } });
    } else {
      setStatusMsg("「よし」「なし」などで回答してください");
    }
  };

  // Choices shown on screen for the active Target Field when it's a click-choice
  // picker (食べ残し / 体調 / うけとり) — empty for any other focus.
  const activeTargetChoices = (): string[] => {
    const key = focusKeyRef.current;
    const group = GROUP_TARGET_FIELDS.find((g) => g.field_key === key);
    if (group) return groupAllOptions(group.options).map((o) => o.label);
    if (key === "uketori" && fields.some((f) => f.field_key === key)) return UKETORI_OPTIONS;
    return [];
  };

  // Records a spoken answer for the active click-choice Target Field exactly as
  // tapping that choice would, then moves the flow on. Returns false if the
  // utterance isn't one of its choices.
  const answerTargetChoice = (rawFinal: string): boolean => {
    const activeGroup = GROUP_TARGET_FIELDS.find((g) => g.field_key === focusKeyRef.current);
    if (activeGroup?.multiple && NEXT_FIELD_COMMAND.test(normalizeJa(rawFinal))) {
      proceedToNextTargetField(activeGroup.field_key);
      return true;
    }
    const choice = matchChoice(rawFinal, activeTargetChoices());
    if (!choice) return false;
    const key = focusKeyRef.current;
    const group = GROUP_TARGET_FIELDS.find((g) => g.field_key === key);
    if (group) {
      const option = groupAllOptions(group.options).find((o) => o.label === choice)!;
      selectGroupOption(group, option, true);
      if (option.next) {
        lastFinalRef.current = "";
        setStatusMsg(`${group.field_label}: 「${option.label}」— ${option.next.map((n) => n.label).join("・")} から選んでください`);
      } else if (!group.multiple) {
        advanceFlow(key, valuesRef.current);
      }
      return true;
    }
    const next = { ...valuesRef.current, [key]: { ...(valuesRef.current[key] || {}), value: choice } };
    valuesRef.current = next;
    setValues(next);
    autoSaveSelection(next);
    setMatchStatus("match");
    setStatusMsg(`「${choice}」を記録しました`);
    advanceFlow(key, next);
    return true;
  };

  // When a yes/no answer is expected (a focused checkbox field, or the final
  // 保存しますか？) and the recognizer's top guess isn't one but a lower-ranked
  // alternative is, use that alternative. Otherwise the top guess stands.
  const pickAnswerAlternative = (top: string, alternatives: string[]): string => {
    if (!alternatives.length) return top;
    let isAnswer: ((t: string) => boolean) | null = null;
    if (flowPhaseRef.current === "confirm-save") {
      isAnswer = (t) => {
        const a = normalizeAnswer(t);
        return CONFIRM_SAVE_YES.test(a) || CONFIRM_SAVE_NO.test(a);
      };
    } else if (activeTargetChoices().length) {
      const choices = activeTargetChoices();
      isAnswer = (t) => matchChoice(t, choices) !== null || NEXT_FIELD_COMMAND.test(normalizeJa(t));
    } else if (fields.find((f) => f.field_key === focusKeyRef.current)?.field_type === "checkbox") {
      isAnswer = isCheckboxAnswer;
    }
    if (!isAnswer || isAnswer(top)) return top;
    return alternatives.find(isAnswer) ?? top;
  };

  const handleFinalTranscript = (text: string, alternatives: string[] = []) => {
    if (!text) return;
    const rawFinal = pickAnswerAlternative(text.trim(), alternatives);
    if (!rawFinal) return;

    if (rawFinal === lastFinalRef.current) return;
    lastFinalRef.current = rawFinal;

    const low = rawFinal.toLowerCase();

    // The auto-flow's final "保存しますか？" confirmation takes priority over every
    // other interpretation while it's pending — nothing else is reachable by
    // voice until this yes/no is answered.
    if (flowPhaseRef.current === "confirm-save") {
      const cleanedConfirm = normalizeAnswer(rawFinal);
      if (CONFIRM_SAVE_YES.test(cleanedConfirm)) {
        confirmSaveYes();
      } else if (CONFIRM_SAVE_NO.test(cleanedConfirm)) {
        confirmSaveNo();
      } else {
        setStatusMsg("「はい」または「いいえ」でお答えください");
      }
      return;
    }

    if (/^(保存|ほぞん|save)$/.test(low)) {
      handleSaveRecord();
      return;
    }

    if (PHOTO_UPLOAD_COMMAND.test(normalizeJa(rawFinal))) {
      handlePhotoButtonClick();
      setStatusMsg("📷 カメラを起動しました");
      return;
    }

    // A clear "よし"/"なし"-style answer to a focused checkbox field is exactly
    // that — handle it before the date/field-switch/patient checks below, which
    // could otherwise claim it (e.g. "なし" partially matching a label like
    // "問題なし" and switching fields instead of answering).
    const focusedField = fields.find((f) => f.field_key === focusKeyRef.current);
    if (focusedField?.field_type === "checkbox" && selectedPatientRef.current && isCheckboxAnswer(rawFinal)) {
      answerCheckbox(focusedField, rawFinal);
      return;
    }

    // Same for an answer naming one of the choices shown for the active
    // click-choice Target Field (食べ残し / 体調 / うけとり) — e.g. "半分" answers
    // 食べ残し rather than jumping to the hidden 半分 column field.
    if (selectedPatientRef.current && answerTargetChoice(rawFinal)) return;

    // Date commands take priority over Target Field dictation — the 記録日/対象年月
    // field sits outside the fields list (it's not voice-selectable via bestFieldMatch),
    // so recognizing it here is the only way to reach it by voice. This is checked
    // against the whole utterance only, so a sentence dictated into some other field
    // that merely happens to contain a date fragment won't trigger it.
    const spokenDate = parseSpokenDate(rawFinal);
    if (spokenDate) {
      if (screenKeyRef.current === "daily_status" && spokenDate.date) {
        setRecordDate(spokenDate.date);
        setStatusMsg(`📅 記録日を ${spokenDate.date} に設定しました`);
      } else if (screenKeyRef.current === "monthly_report" && spokenDate.month) {
        setYearMonth(spokenDate.month);
        setStatusMsg(`📅 対象年月を ${spokenDate.month} に設定しました`);
      }
      return;
    }

    // Target User by voice — checked before Target Field matching, so a short
    // name after 利用者 (e.g. 「利用者 田中」) can't be mistaken for a field label.
    const patientVoiceMatch = rawFinal.match(
      /^(利用者|患者|patient|patid|pat_id)\s*[:：]?\s*(.+)$/i
    );
    const currentFocusField = fields.find((f) => f.field_key === focusKeyRef.current);
    const isPatientSelectFieldFocused = currentFocusField?.field_label === PATIENT_SELECT_FIELD_LABEL;
    // With no patient selected yet, nothing else can be answered, so any
    // utterance that isn't a Target Field name is taken as a patient search —
    // including kanji names (山田太郎), which is how the recognizer usually
    // writes them. Once a patient is selected, a spoken pat_id (digits only)
    // still switches patients, unless the focused field takes typed/dictated
    // input (number or text), where digits are that field's answer.
    const fieldSwitchTarget = bestFieldMatch(rawFinal, pickerFields.length ? (pickerFields as unknown as Field[]) : fields);
    const impliedPatientShortcut = selectedPatientRef.current
      ? isSpokenIdOnly(rawFinal) && currentFocusField?.field_type !== "number" && currentFocusField?.field_type !== "text"
      : !fieldSwitchTarget || isLikelyPatientShortcut(rawFinal);
    // Saying a field name while parked on 利用者選択 still jumps to that field.
    if (patientVoiceMatch || impliedPatientShortcut || (isPatientSelectFieldFocused && !fieldSwitchTarget)) {
      const patientText = patientVoiceMatch
        ? patientVoiceMatch[2]?.trim() ?? ""
        : rawFinal.trim();
      if (!patientText) {
        setStatusMsg("利用者を指定してください（例: やまだたろう / 12345）");
        return;
      }
      // Only the "利用者選択" field wires the matched patient back into its own value.
      patientFieldVoiceKeyRef.current = isPatientSelectFieldFocused ? focusKeyRef.current : null;
      setIsSearching(true);
      patientSelectSourceRef.current = "voice";
      setPatientVoiceText(patientText);
      setPatientVoiceRequestId((id) => id + 1);
      setStatusMsg(`利用者検索: ${patientText}`);
      return;
    }

    // On a screen with Target Field entries (うけとり / 食べ残し / 体調), voice may
    // only switch between those entries — a spoken word that happens to name one
    // of the hidden report columns (メモ, 半分, 完食, …) must never become the
    // displayed Target Field. If that column belongs to the current field, it's
    // taken as the answer (完食 → なし, 残し → あり, …).
    if (pickerFields.length) {
      const pickerMatch = bestFieldMatch(rawFinal, pickerFields as unknown as Field[]);
      if (pickerMatch && pickerMatch.field_key !== focusKeyRef.current) {
        setFocusKey(pickerMatch.field_key);
        focusKeyRef.current = pickerMatch.field_key;
        setStatusMsg(`➡ ${pickerMatch.field_label} に切り替えました`);
        setMatchStatus("none");
        setMatches([]);
        return;
      }
      const hiddenMatch = bestFieldMatch(rawFinal, fields);
      if (hiddenMatch) {
        const activeGroup = GROUP_TARGET_FIELDS.find((g) => g.field_key === focusKeyRef.current);
        const leaf = activeGroup && groupLeafOptions(activeGroup.options).find((o) => o.key === hiddenMatch.field_key);
        if (!(leaf && selectedPatientRef.current && answerTargetChoice(leaf.label))) {
          setStatusMsg("候補に一致しませんでした");
        }
        return;
      }
    }

    // Switching the Target Field by voice takes priority over any other interpretation,
    // so saying a field name always jumps there — even while parked on "利用者選択"
    // (which would otherwise swallow every utterance as a patient search).
    const matchedField = bestFieldMatch(rawFinal, fields);
    if (matchedField && matchedField.field_key !== focusKeyRef.current) {
      setIsSearching(true);
      setFocusKey(matchedField.field_key);
      focusKeyRef.current = matchedField.field_key;
      setStatusMsg(`➡ ${matchedField.field_label} に切り替えました`);
      setMatchStatus("none");
      setMatches([]);
      setIsSearching(false);
      return;
    }

    if (/^コメント/.test(rawFinal)) {
      const comment = rawFinal.replace(/^コメント[:：]?\s*/, "");
      const group = GROUP_TARGET_FIELDS.find((g) => g.field_key === focusKeyRef.current);
      const currentKey = group ? group.anchorKey : focusKeyRef.current;
      const label = group ? group.field_label : fields.find((f) => f.field_key === currentKey)?.field_label;
      if (label) {
        setValues((v) => ({ ...v, [currentKey]: { ...(v[currentKey] || {}), comment } }));
        setStatusMsg(`${label} のコメントを追加しました`);
      }
      return;
    }

    const currentKey = focusKeyRef.current;
    const field = fields.find((f) => f.field_key === currentKey);
    if (!field) return;

    if (field.field_type === "checkbox") {
      answerCheckbox(field, rawFinal);
      return;
    }

    if (field.field_type === "number") {
      // Try digits the recognizer already transcribed as numerals first (incl.
      // fullwidth), then fall back to digit-by-digit readings like "まる"/"れい"/
      // kanji numerals (same convention used for pat_id — see normalizeSpokenDigits).
      const plainDigits = normalizeJa(rawFinal).replace(/[^0-9.\-]/g, "");
      const numeric = plainDigits || normalizeSpokenDigits(rawFinal);
      if (numeric && !Number.isNaN(Number(numeric))) {
        setFieldValue(currentKey, Number(numeric));
        setStatusMsg(`${field.field_label} に ${numeric} を入力しました`);
        advanceFlow(currentKey, { ...valuesRef.current, [currentKey]: { ...(valuesRef.current[currentKey] || {}), value: Number(numeric) } });
      } else {
        setStatusMsg("数字で回答してください");
      }
      return;
    }

    if (field.field_type === "text" || field.field_type === "preset") {
      if (field.phrases?.length) {
        checkMatchAgainstPhrases(rawFinal, field.phrases, currentKey);
      } else {
        setFieldValue(currentKey, rawFinal);
        setStatusMsg(`${field.field_label} に入力しました`);
        advanceFlow(currentKey, { ...valuesRef.current, [currentKey]: { ...(valuesRef.current[currentKey] || {}), value: rawFinal } });
      }
      return;
    }
  };

  const handleSaveRecord = async () => {
    const patient = selectedPatientRef.current;
    if (!patient) {
      setStatusMsg("❌ 利用者が選択されていません");
      return;
    }
    const screen = screenKeyRef.current;
    const baseParams =
      screen === "daily_status"
        ? { screen_key: screen, patient_id: patient.id, record_date: recordDateRef.current }
        : { screen_key: screen, patient_id: patient.id, record_year_month: yearMonthRef.current };

    // 配食者名 (report's daily "delivery person" column) isn't a picker field —
    // it's always the logged-in user, stamped on save.
    const payloadValues =
      screen === "daily_status"
        ? { ...valuesRef.current, delivery_person: { value: user?.username || "" } }
        : valuesRef.current;

    setSavingRecord(true);
    try {
      await saveStatusRecord({ ...baseParams, values: payloadValues });

      // Pending previews are only actually uploaded once the record itself has saved.
      const toUpload = pendingPhotosRef.current;
      if (toUpload.length > 0) {
        // Uploaded and attached to the record now — drop the local previews
        // immediately rather than folding the server copies back into view.
        await uploadStatusPhotos({ ...baseParams, files: toUpload.map((p) => p.file) });
        toUpload.forEach((p) => URL.revokeObjectURL(p.url));
        setPendingPhotos([]);
        setStatusMsg(`✅ 保存しました（写真${toUpload.length}枚を含む）`);
      } else {
        setStatusMsg("✅ 保存しました");
      }

      setMatches([]);
      setMatchStatus("none");
      setTranscript("");
      lastFinalRef.current = "";
      // Force a clean recognition instance after save so voice input keeps
      // accepting commands even if the browser silently ended the session
      // during the save (see createRecognition/restartRecognition above).
      if (isListeningRef.current) restartRecognition();
    } catch (e) {
      console.error("save failed", e);
      const detail = e instanceof Error ? e.message : "";
      setStatusMsg(detail ? `❌ 保存に失敗しました（${detail}）` : "❌ 保存に失敗しました");
    } finally {
      setSavingRecord(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      {selectedPatient && (
        <div className={styles.scopeBar}>
          <div className={styles.scopeBarControls}>
            <div className="d-flex gap-2">
              {SCREENS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  // 月次報告 is hidden from view; its screen and logic are left as they are.
                  hidden={s.key === "monthly_report"}
                  className={`btn btn-sm ${styles.toolbarBtn} ${screenKey === s.key ? "btn-primary" : "btn-outline-primary"}`}
                  onClick={() => setScreenKey(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {screenKey === "daily_status" ? (
              <JaDateInput
                className={`form-control form-control-sm ${styles.toolbarBtn}`}
                maxWidth={250}
                value={recordDate}
                onChange={setRecordDate}
              />
            ) : (
              <JaMonthInput
                className="form-control form-control-sm"
                value={yearMonth}
                onChange={setYearMonth}
              />
            )}
            <button
              type="button"
              className={`btn btn-sm btn-outline-primary ${styles.photoUploadBtn} ${styles.toolbarBtn}`}
              onClick={handlePhotoButtonClick}
            >
              <CameraFill size="1em" />
              <span>写真追加</span>
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="d-none"
              onChange={(e) => handlePhotoFilesSelected(e.target.files)}
            />
            <button
              type="button"
              className={`btn btn-sm btn-outline-primary ${styles.photoUploadBtn} ${styles.toolbarBtn}`}
              onClick={() => setQrOpen(true)}
              disabled={isSearching}
            >
              <QrCodeScan size="1em" />
              <span>QR読取</span>
            </button>
            {allTargetFieldsAnswered && (
              <button
                type="button"
                className={`btn btn-success ms-auto px-4 fw-bold ${styles.toolbarBtn}`}
                onClick={handleSaveRecord}
                disabled={savingRecord}
              >
                {savingRecord && <Spinner key="saving-spinner" className="me-1" animation="border" size="sm" />}
                <span>保存</span>
              </button>
            )}
          </div>

          {pendingDisplay.length > 0 && (
            <div className={styles.photoStrip}>
              {pendingDisplay.map((photo, i) => (
                <div
                  key={photo.id}
                  className={`${styles.photoThumb} ${styles.photoThumbPending}`}
                  onClick={() => setLightboxIndex(i)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.original_filename || "写真"} />
                  <span className={styles.photoThumbPendingBadge}>未保存</span>
                  <button
                    type="button"
                    className={styles.photoThumbDelete}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePendingPhoto(photo);
                    }}
                    title="削除"
                  >
                    <Trash size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {cameraOpen && (
        <CameraCapture
          onConfirm={handleCameraConfirm}
          onClose={() => setCameraOpen(false)}
          onFallbackToFile={handlePickFromFile}
        />
      )}

      {qrOpen && <QRScanner onScan={handleQrScan} onClose={() => setQrOpen(false)} />}

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={pendingDisplay}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onDelete={handleRemovePendingPhoto}
        />
      )}

      <div className={styles.targetBox}>
        <PatientSelector
          externalVoiceText={patientVoiceText}
          externalVoiceRequestId={patientVoiceRequestId}
          onManualSelect={(patient) => {
            // Same as QR: re-picking the patient already selected doesn't
            // change the selection, so don't leave a mark behind.
            if (patient.id !== selectedPatientRef.current?.id) patientSelectSourceRef.current = "manual";
          }}
          onExternalVoiceResult={({ matched, message, patient }) => {
            setIsSearching(false);
            // A voice search that found no one mustn't leave its "voice"
            // mark behind for a later manual pick to inherit.
            // Same for one that matched the patient already selected (the
            // selection doesn't change, so the effect that consumes it won't run).
            if (!matched || patient?.id === selectedPatientRef.current?.id) patientSelectSourceRef.current = null;
            setStatusMsg(matched ? `✅ ${message}` : `❌ ${message}`);
            const fieldKey = patientFieldVoiceKeyRef.current;
            if (fieldKey) {
              patientFieldVoiceKeyRef.current = null;
              if (matched && patient) setFieldValue(fieldKey, patient.name);
            }
          }}
        />

        {!selectedPatient ? (
          <p style={{ textAlign: "center", color: "var(--secondary-text)", fontSize: "var(--text-fs)", marginTop: "0.5rem", marginBottom: 0 }}>
            マイクで利用者名・ふりがな・pat_id を話すか、上のリストから選択してください。
          </p>
        ) : (
          <div style={{ marginTop: "0.5rem" }}>
            {/* The 対象フィールド dropdown is hidden from view. The active Target
                Field (focusKey) is still driven by the voice flow, taps and
                spoken field names; its own question card is shown below. */}
            <div hidden>
            <label>対象フィールド</label>
            <div className={styles.fieldDropdown} ref={fieldMenuRef}>
              <button
                type="button"
                className={`${styles.fieldTrigger} ${fieldMenuOpen ? styles.fieldTriggerOpen : ""}`}
                onClick={() => setFieldMenuOpen((v) => !v)}
              >
                <span>{(focusField ?? focusGroupField)?.field_label ?? "選択してください"}</span>
                <ChevronDown
                  size={14}
                  className={`${styles.fieldChevron} ${fieldMenuOpen ? styles.fieldChevronOpen : ""}`}
                />
              </button>
              {fieldMenuOpen && (
                <div className={styles.fieldPanel}>
                  {pickerFields.map((f) => (
                    <button
                      key={f.field_key}
                      type="button"
                      className={`${styles.fieldOption} ${
                        f.field_key === focusKey ? styles.fieldOptionActive : ""
                      }`}
                      onClick={() => setFocusKey(f.field_key)}
                    >
                      {f.field_label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            </div>

            {!isPatientSelectField && (
              <Fragment key={focusKey ?? "none"}>
                {focusGroupField && (
                  <div key={`group-${focusGroupField.field_key}`} className="card border-0 shadow-sm rounded-4 mt-1">
                    <div className="card-body">
                      <h6 className={`card-title d-flex align-items-center mb-1 ${styles.choiceTitle}`}>
                        <span className="badge bg-primary me-2 rounded-pill">🎯</span>
                        {focusGroupField.field_label} の候補（{focusGroupField.multiple ? "複数選択可" : "クリックで選択"}）
                      </h6>
                      <div className="list-group list-group-flush">
                        {focusGroupField.options.map((o) => {
                          const isSelected = isGroupOptionSelected(o, values);
                          const showNext = !!o.next && (openGroupOption === o.label || isSelected);
                          return (
                            <Fragment key={o.label}>
                              <button
                                type="button"
                                className="list-group-item list-group-item-action border-0 px-0 py-0 d-flex align-items-center bg-transparent"
                                onClick={() => {
                                  selectGroupOption(focusGroupField, o);
                                  // A single-choice pick answers the field, so the
                                  // auto-flow moves on just as for a spoken answer.
                                  if (!focusGroupField.multiple && !o.next) advanceFlow(focusGroupField.field_key, valuesRef.current);
                                }}
                              >
                                <span
                                  className={`badge ${isSelected ? "bg-success" : "bg-light text-dark"} me-2 rounded-pill`}
                                >
                                  {isSelected ? "✅" : "・"}
                                </span>
                                <span className={`fw-medium ${styles.choiceLabel} ${isSelected ? "text-success" : ""}`}>{o.label}</span>
                              </button>
                              {showNext &&
                                o.next!.map((n) => {
                                  const isNextSelected = isGroupOptionSelected(n, values);
                                  return (
                                    <button
                                      key={n.label}
                                      type="button"
                                      className="list-group-item list-group-item-action border-0 ps-4 pe-0 py-0 d-flex align-items-center bg-transparent"
                                      onClick={() => {
                                        selectGroupOption(focusGroupField, n);
                                        if (!focusGroupField.multiple && !n.next) advanceFlow(focusGroupField.field_key, valuesRef.current);
                                      }}
                                    >
                                      <span
                                        className={`badge ${isNextSelected ? "bg-success" : "bg-light text-dark"} me-2 rounded-pill`}
                                      >
                                        {isNextSelected ? "✅" : "・"}
                                      </span>
                                      <span className={`fw-medium ${styles.choiceLabel} ${isNextSelected ? "text-success" : ""}`}>{n.label}</span>
                                    </button>
                                  );
                                })}
                            </Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Manual input, in addition to voice */}
                {focusField && focusField.field_type === "checkbox" && (() => {
                  const isChecked = values[focusField.field_key]?.value === true;
                  return (
                    <div
                      key={`checkbox-${focusField.field_key}-${isChecked}`}
                      className={`${styles.checkboxToggle} ${isChecked ? styles.checked : ""}`}
                      onClick={() => {
                        const newValue = !isChecked;
                        const key = focusField.field_key;
                        setFieldValue(key, newValue);
                        advanceFlow(key, { ...valuesRef.current, [key]: { ...(valuesRef.current[key] || {}), value: newValue } });
                      }}
                    >
                      {isChecked ? <CheckCircleFill /> : <Circle />}
                      {isChecked ? "チェック済み" : "未チェック（クリックでチェック）"}
                    </div>
                  );
                })()}

                {focusField && focusField.field_type === "preset" && focusField.phrases?.length > 0 && (() => {
                  const presetOptions = focusField.field_key === "uketori" ? UKETORI_OPTIONS : focusField.phrases;
                  return (
                  <div key={`preset-${focusField.field_key}`} className="card border-0 shadow-sm rounded-4 mt-1">
                    <div className="card-body">
                      <h6 className={`card-title d-flex align-items-center mb-1 ${styles.choiceTitle}`}>
                        <span className="badge bg-primary me-2 rounded-pill">🎯</span>
                        {focusField.field_label} の候補（クリックで選択、{presetOptions.length}件）
                      </h6>
                      <div className="list-group list-group-flush">
                        {presetOptions.map((p) => {
                          const isSelected = values[focusField.field_key]?.value === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              className="list-group-item list-group-item-action border-0 px-0 py-0 d-flex align-items-center bg-transparent"
                              onClick={() => {
                                const key = focusField.field_key;
                                setFieldValue(key, p);
                                const snapshot = { ...valuesRef.current, [key]: { ...(valuesRef.current[key] || {}), value: p } };
                                if (key === "uketori") autoSaveSelection(snapshot);
                                advanceFlow(key, snapshot);
                              }}
                            >
                              <span
                                className={`badge ${isSelected ? "bg-success" : "bg-light text-dark"} me-2 rounded-pill`}
                              >
                                {isSelected ? "✅" : "・"}
                              </span>
                              <span className={`fw-medium ${styles.choiceLabel} ${isSelected ? "text-success" : ""}`}>{p}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  );
                })()}

                {focusField && focusField.field_type === "text" && (
                  <div key={`text-${focusField.field_key}`} className="mt-1">
                    <label className="form-label fw-semibold text-muted text-uppercase small mb-1">
                      値（手入力）
                    </label>
                    <textarea
                      className="form-control border-0 shadow-sm rounded-3"
                      rows={1}
                      value={manualText}
                      onChange={(e) => {
                        setManualText(e.target.value);
                        setFieldValue(focusField.field_key, e.target.value);
                      }}
                      onBlur={() => advanceFlow(focusField.field_key)}
                    />
                  </div>
                )}

              </Fragment>
            )}

          </div>
        )}
      </div>

      {selectedPatient && commentKey && !isPatientSelectField && (
        <div key={`comment-${commentKey}`} className={styles.commentBox}>
          <label htmlFor="target-field-comment" className={styles.commentLabel}>
            <ChatLeftText size="1em" />
            コメント（自由入力）
          </label>
          <textarea
            id="target-field-comment"
            className={styles.commentInput}
            rows={1}
            placeholder="ここに意見や補足を入力できます"
            value={values[commentKey]?.comment ?? ""}
            onChange={(e) => {
              const text = e.target.value;
              setValues((prev) => ({
                ...prev,
                [commentKey]: { ...(prev[commentKey] || {}), comment: text },
              }));
            }}
          />
        </div>
      )}

      {transcript && (
        <div className={styles.transcriptBox}>
          <p>{transcript}</p>
        </div>
      )}
      {statusMsg && (
        <div
          className={`alert ${
            statusMsg.includes("✅") ? "alert-success" : statusMsg.includes("❌") ? "alert-danger" : "alert-info"
          } rounded-4 shadow-sm border-0`}
        >
          {statusMsg}
        </div>
      )}

      {awaitingSaveConfirm && (
        <div className="d-flex gap-2 justify-content-center">
          <button type="button" className="btn btn-success" onClick={confirmSaveYes} disabled={savingRecord}>
            はい（保存する）
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={confirmSaveNo} disabled={savingRecord}>
            いいえ
          </button>
        </div>
      )}

      <div className={styles.controls}>
        <button
          className={`${styles.micButton} ${isListening ? styles.isListening : ""}`}
          onClick={isListening ? handleStopListening : handleStartListening}
          aria-label={isListening ? "リスニング停止" : "リスニング開始"}
          disabled={isSearching}
        >
          {isListening ? <StopFill size={28} /> : <MicFill size={28} />}
        </button>
        {isSearching && <p className={styles.statusText}>検索中…</p>}
      </div>

      {selectedPatient && matchStatus === "match" && (
        <div className="alert alert-success rounded-4 shadow-sm border-0 text-center">
          🎯 候補 {matches.length} 件の中から最適なものを選択しました
        </div>
      )}

    </div>
  );
}
