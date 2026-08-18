// app/components/dashboard/StatusMatcher.tsx
"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { MicFill, StopFill, CheckCircleFill, Circle, ChevronDown, CameraFill, Trash } from "react-bootstrap-icons";
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
import { JaDateInput, JaMonthInput } from "@/app/components/JaDatePicker";
import PatientSelector from "@/app/components/dashboard/PatientSelector";
import PhotoLightbox from "@/app/components/dashboard/PhotoLightbox";
import { normalizeSpokenDigits } from "@/app/lib/voiceText";

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
type SpokenItem = { text: string; at: number };

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
// "写真アップロード" covers the recognizer dropping the を particle; "写真追加"
// matches the visible button label so saying what's on screen also works.
const PHOTO_UPLOAD_COMMAND = /^(写真を?アップロード|アップロード写真|写真追加|uploadphoto|photoupload)$/;
const PATIENT_SELECT_FIELD_LABEL = "利用者選択";

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
  const { selectedPatient } = usePatient();

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
  const [spokenLog, setSpokenLog] = useState<SpokenItem[]>([]);
  const [manualText, setManualText] = useState("");
  const [patientVoiceText, setPatientVoiceText] = useState("");
  const [patientVoiceRequestId, setPatientVoiceRequestId] = useState(0);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  // Selected but not yet uploaded — local object URLs only, discarded unless 保存 is pressed.
  const [pendingPhotos, setPendingPhotos] = useState<{ id: number; file: File; url: string }[]>([]);
  const [savingRecord, setSavingRecord] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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
      if (rows.length) setFocusKey(rows[0].field_key);
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

  const handlePhotoButtonClick = () => photoInputRef.current?.click();

  // Just stages a local preview — nothing is sent to the server until 保存 is
  // pressed. Only one photo per patient per day is kept, so picking a new
  // file replaces whatever was already staged rather than adding to it.
  const handlePhotoFilesSelected = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    pendingIdRef.current -= 1;
    const item = { id: pendingIdRef.current, file, url: URL.createObjectURL(file) };
    setPendingPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [item];
    });
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

  useEffect(() => {
    setManualText(String(values[focusKey]?.value ?? ""));
    setFieldMenuOpen(false);
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

  const logUtter = (text: string) => {
    setSpokenLog([{ text, at: Date.now() }]);
  };

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

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) handleFinalTranscript(chunk);
        else interim += chunk;
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
    if (isListeningRef.current) return;
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
    } else {
      setMatchStatus("no-match");
      setStatusMsg("候補に一致しませんでした");
    }
  };

  const handleFinalTranscript = (text: string) => {
    if (!text) return;
    const rawFinal = text.trim();
    if (!rawFinal) return;

    logUtter(rawFinal);

    if (rawFinal === lastFinalRef.current) return;
    lastFinalRef.current = rawFinal;

    const low = rawFinal.toLowerCase();

    if (/^(保存|ほぞん|save)$/.test(low)) {
      handleSaveRecord();
      return;
    }

    if (PHOTO_UPLOAD_COMMAND.test(normalizeJa(rawFinal))) {
      handlePhotoButtonClick();
      setStatusMsg("📷 写真選択ダイアログを開きました");
      return;
    }

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

    // Switching the Target Field by voice takes priority over any other interpretation,
    // so saying a field name always jumps there — even while parked on "利用者選択"
    // (which would otherwise swallow every utterance as a patient search).
    const matchedField = bestFieldMatch(rawFinal, fields);
    if (matchedField && matchedField.field_key !== focusKeyRef.current) {
      setFocusKey(matchedField.field_key);
      focusKeyRef.current = matchedField.field_key;
      setStatusMsg(`➡ ${matchedField.field_label} に切り替えました`);
      setMatchStatus("none");
      setMatches([]);
      return;
    }

    const patientVoiceMatch = rawFinal.match(
      /^(利用者|患者|patient|patid|pat_id)\s*[:：]?\s*(.+)$/i
    );
    const currentFocusField = fields.find((f) => f.field_key === focusKeyRef.current);
    const isPatientSelectFieldFocused = currentFocusField?.field_label === PATIENT_SELECT_FIELD_LABEL;
    const impliedPatientShortcut = !selectedPatientRef.current && isLikelyPatientShortcut(rawFinal);
    if (patientVoiceMatch || impliedPatientShortcut || isPatientSelectFieldFocused) {
      const patientText = patientVoiceMatch
        ? patientVoiceMatch[2]?.trim() ?? ""
        : rawFinal.trim();
      if (!patientText) {
        setStatusMsg("利用者を指定してください（例: やまだたろう / 12345）");
        return;
      }
      // Only the "利用者選択" field wires the matched patient back into its own value.
      patientFieldVoiceKeyRef.current = isPatientSelectFieldFocused ? focusKeyRef.current : null;
      setPatientVoiceText(patientText);
      setPatientVoiceRequestId((id) => id + 1);
      setStatusMsg(`利用者検索: ${patientText}`);
      return;
    }

    if (/^コメント/.test(rawFinal)) {
      const comment = rawFinal.replace(/^コメント[:：]?\s*/, "");
      const currentKey = focusKeyRef.current;
      const field = fields.find((f) => f.field_key === currentKey);
      if (field) {
        setValues((v) => ({ ...v, [currentKey]: { ...(v[currentKey] || {}), comment } }));
        setStatusMsg(`${field.field_label} のコメントを追加しました`);
      }
      return;
    }

    const currentKey = focusKeyRef.current;
    const field = fields.find((f) => f.field_key === currentKey);
    if (!field) return;

    if (field.field_type === "checkbox") {
      const cleaned = normalizeJa(rawFinal);
      if (AFFIRMATIVE.test(cleaned) || cleaned === normalizeJa(field.field_label)) {
        setFieldValue(currentKey, true);
        setStatusMsg(`${field.field_label}: チェックしました`);
      } else if (NEGATIVE.test(cleaned)) {
        setFieldValue(currentKey, false);
        setStatusMsg(`${field.field_label}: チェックを外しました`);
      } else {
        setStatusMsg("「よし」「なし」などで回答してください");
      }
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

    setSavingRecord(true);
    try {
      await saveStatusRecord({ ...baseParams, values: valuesRef.current });

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
      setStatusMsg("❌ 保存に失敗しました");
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
                  className={`btn btn-sm ${screenKey === s.key ? "btn-primary" : "btn-outline-primary"}`}
                  onClick={() => setScreenKey(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {screenKey === "daily_status" ? (
              <JaDateInput
                className="form-control form-control-sm"
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
              className={`btn btn-sm btn-outline-primary ${styles.photoUploadBtn}`}
              onClick={handlePhotoButtonClick}
            >
              <CameraFill size={14} />
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
              className="btn btn-sm btn-success ms-auto"
              onClick={handleSaveRecord}
              disabled={savingRecord}
            >
              {savingRecord && <Spinner key="saving-spinner" className="me-1" animation="border" size="sm" />}
              <span>保存</span>
            </button>
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
          locked={!isPatientSelectField}
          onExternalVoiceResult={({ matched, message, patient }) => {
            setStatusMsg(matched ? `✅ ${message}` : `❌ ${message}`);
            const fieldKey = patientFieldVoiceKeyRef.current;
            if (fieldKey) {
              patientFieldVoiceKeyRef.current = null;
              if (matched && patient) setFieldValue(fieldKey, patient.name);
            }
          }}
        />

        {!selectedPatient ? (
          <p style={{ textAlign: "center", color: "var(--secondary-text)", marginTop: "1.25rem", marginBottom: 0 }}>
            マイクで利用者名・ふりがな・pat_id を話すか、上のリストから選択してください。
          </p>
        ) : (
          <div style={{ marginTop: "1.5rem" }}>
            <label>対象フィールド</label>
            <div className={styles.fieldDropdown} ref={fieldMenuRef}>
              <button
                type="button"
                className={`${styles.fieldTrigger} ${fieldMenuOpen ? styles.fieldTriggerOpen : ""}`}
                onClick={() => setFieldMenuOpen((v) => !v)}
              >
                <span>{focusField?.field_label ?? "選択してください"}</span>
                <ChevronDown
                  size={14}
                  className={`${styles.fieldChevron} ${fieldMenuOpen ? styles.fieldChevronOpen : ""}`}
                />
              </button>
              {fieldMenuOpen && (
                <div className={styles.fieldPanel}>
                  {fields.map((f) => (
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

            {!isPatientSelectField && (
              <>
                <label style={{ marginTop: 10 }}>現在の値</label>
                <p>
                  {focusKey ? JSON.stringify(values[focusKey]?.value ?? "", null, 0) : "---"}
                </p>

                {/* Manual input, in addition to voice */}
                {focusField && focusField.field_type === "checkbox" && (
                  <div
                    className={`${styles.checkboxToggle} ${
                      values[focusField.field_key]?.value === true ? styles.checked : ""
                    }`}
                    onClick={() =>
                      setFieldValue(focusField.field_key, !(values[focusField.field_key]?.value === true))
                    }
                  >
                    {values[focusField.field_key]?.value === true ? (
                      <CheckCircleFill />
                    ) : (
                      <Circle />
                    )}
                    {values[focusField.field_key]?.value === true ? "チェック済み" : "未チェック（クリックでチェック）"}
                  </div>
                )}

                {focusField && focusField.field_type === "preset" && focusField.phrases?.length > 0 && (
                  <div className="card border-0 shadow-sm rounded-4 mt-3">
                    <div className="card-body">
                      <h6 className="card-title d-flex align-items-center mb-3">
                        <span className="badge bg-primary me-2 rounded-pill">🎯</span>
                        {focusField.field_label} の候補（クリックで選択、{focusField.phrases.length}件）
                      </h6>
                      <div className="list-group list-group-flush">
                        {focusField.phrases.map((p) => {
                          const isSelected = values[focusField.field_key]?.value === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              className="list-group-item list-group-item-action border-0 px-0 py-2 d-flex align-items-center bg-transparent"
                              onClick={() => setFieldValue(focusField.field_key, p)}
                            >
                              <span
                                className={`badge ${isSelected ? "bg-success" : "bg-light text-dark"} me-3 rounded-pill`}
                              >
                                {isSelected ? "✅" : "・"}
                              </span>
                              <span className={`fw-medium ${isSelected ? "text-success" : ""}`}>{p}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {focusField && focusField.field_type === "text" && (
                  <div className="mt-3">
                    <label className="form-label fw-semibold text-muted text-uppercase small mb-2">
                      値（手入力）
                    </label>
                    <textarea
                      className="form-control border-0 shadow-sm rounded-3"
                      rows={2}
                      value={manualText}
                      onChange={(e) => {
                        setManualText(e.target.value);
                        setFieldValue(focusField.field_key, e.target.value);
                      }}
                    />
                  </div>
                )}

                {focusField && (
                  <div className="mt-3">
                    <label className="form-label fw-semibold text-muted text-uppercase small mb-2">
                      コメント（自由入力）
                    </label>
                    <textarea
                      className="form-control border-0 shadow-sm rounded-3"
                      rows={2}
                      placeholder="ここに意見や補足を入力できます（または「コメント〜」と話してください）"
                      value={values[focusField.field_key]?.comment ?? ""}
                      onChange={(e) => {
                        const text = e.target.value;
                        setValues((prev) => ({
                          ...prev,
                          [focusField.field_key]: { ...(prev[focusField.field_key] || {}), comment: text },
                        }));
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className={styles.transcriptBox}>
        {transcript ? (
          <p>{transcript}</p>
        ) : (
          <p className={styles.placeholder}>
            マイクで話してください…（例：「完食」「よし」「コメント〜」「今日」「8月6日」「保存」「やまだたろう」「12345」「写真をアップロード」）
          </p>
        )}
      </div>
      {statusMsg && (
        <div
          className={`alert ${
            statusMsg.includes("✅") ? "alert-success" : statusMsg.includes("❌") ? "alert-danger" : "alert-info"
          } rounded-4 shadow-sm border-0`}
        >
          {statusMsg}
        </div>
      )}

      <div className={styles.controls}>
        <button
          className={`${styles.micButton} ${isListening ? styles.isListening : ""}`}
          onClick={isListening ? handleStopListening : handleStartListening}
          aria-label={isListening ? "リスニング停止" : "リスニング開始"}
        >
          {isListening ? <StopFill size={32} /> : <MicFill size={32} />}
        </button>
        <p className={styles.statusText}>
          {isListening ? "リスニング中…（連続で話してOK。「保存」で終了）" : "マイクボタンで開始、または手入力してください"}
        </p>
      </div>

      {selectedPatient && matchStatus === "match" && (
        <div className="alert alert-success rounded-4 shadow-sm border-0 text-center">
          🎯 候補 {matches.length} 件の中から最適なものを選択しました
        </div>
      )}
      {selectedPatient && matchStatus === "no-match" && (
        <div className="alert alert-warning rounded-4 shadow-sm border-0 text-center">
          🤔 フレーズ候補に該当するものがありませんでした
        </div>
      )}

      {spokenLog.length > 0 && (
        <div className="card border-0 shadow-sm rounded-4">
          <div className="card-body text-center">
            <h6 className="mb-2">🗣 最新の発話</h6>
            <code className="bg-light px-3 py-2 rounded fw-medium fs-6">{spokenLog[0].text}</code>
          </div>
        </div>
      )}

      {selectedPatient && (
        <div className="card border-0 shadow-sm rounded-4">
          <div className="card-body">
            <h5 className="card-title mb-3">📋 現在の入力内容（保存対象）</h5>
            {Object.keys(values).length === 0 ? (
              <div className="text-center text-muted py-4">データがありません</div>
            ) : (
              <div className="list-group list-group-flush">
                {fields
                  .filter((f) => values[f.field_key] !== undefined)
                  .map((f) => {
                    const data = values[f.field_key];
                    return (
                      <div key={f.field_key} className="list-group-item border-0 px-0 py-2">
                        <span className="badge bg-light text-dark me-2 rounded-pill fw-bold">
                          {f.field_label}
                        </span>
                        {data.value !== undefined && (
                          <small className="text-muted">
                            値: <code className="bg-light px-2 py-1 rounded">{JSON.stringify(data.value)}</code>
                          </small>
                        )}
                        {data.comment && (
                          <small className="text-muted ms-2">
                            コメント: <span className="fst-italic">{data.comment}</span>
                          </small>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
