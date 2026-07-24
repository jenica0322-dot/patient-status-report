// app/components/dashboard/StatusMatcher.tsx
"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { MicFill, StopFill, CheckCircleFill, Circle } from "react-bootstrap-icons";
import styles from "@/app/styles/StatusMatcher.module.css";
import {
  fetchStatusFields,
  saveStatusRecord,
  fetchStatusRecords,
} from "@/app/lib/statusApi";
import { usePatient } from "@/app/context/PatientContext";
import { JaDateInput, JaMonthInput } from "@/app/components/JaDatePicker";

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

function bestFieldMatch(utterance: string, fields: Field[]): Field | null {
  const cleaned = normalizeJa(utterance);
  let best: { f: Field; score: number } | null = null;
  for (const f of fields) {
    const dist = levenshteinDistance(cleaned, normalizeJa(f.field_label));
    const maxLen = Math.max(cleaned.length, f.field_label.length);
    const sim = ((maxLen - dist) / maxLen) * 100;
    if (!best || sim > best.score) best = { f, score: sim };
  }
  return best && best.score >= 60 ? best.f : null;
}

const AFFIRMATIVE = /^(よし|した|できた|チェック|レ|まる|○|✓|ok|オーケー)$/;
const NEGATIVE = /^(なし|しない|できていない|ばつ|×|no)$/;

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

  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isListeningRef = useRef(false);
  const lastFinalRef = useRef<string>("");
  const focusKeyRef = useRef<string>("");
  const valuesRef = useRef<Record<string, { value?: any; comment?: string }>>({});

  useEffect(() => {
    focusKeyRef.current = focusKey;
  }, [focusKey]);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

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

  const focusField = useMemo(
    () => fields.find((f) => f.field_key === focusKey),
    [fields, focusKey]
  );

  useEffect(() => {
    setManualText(String(values[focusKey]?.value ?? ""));
  }, [focusKey]);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
      streamRef.current?.getTracks()?.forEach((t) => t.stop());
    },
    []
  );

  const logUtter = (text: string) => {
    setSpokenLog([{ text, at: Date.now() }]);
  };

  const handleStartListening = async () => {
    if (isListeningRef.current) return;
    if (!(await canRecordMic())) return;

    setTranscript("");
    setStatusMsg("");
    setMatchStatus("none");
    setMatches([]);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SR();
      const rec = recognitionRef.current;
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

      rec.onend = () => {
        if (isListeningRef.current) {
          try {
            rec.start();
          } catch (err) {
            console.warn("restart failed:", err);
          }
        }
      };
      rec.onerror = (ev: any) => {
        console.warn("Speech error:", ev?.error);
        stopAll();
      };

      rec.start();
      setIsListening(true);
      isListeningRef.current = true;
    } catch (err: any) {
      console.error("getUserMedia error:", err?.name, err);
      if (err?.name === "NotAllowedError")
        alert("マイクへのアクセスが拒否されました。ブラウザのサイト設定で許可してください。");
      else if (err?.name === "NotReadableError")
        alert("マイクが他のアプリで使用中の可能性があります。");
      else alert("マイクを開始できませんでした。");
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        streamRef.current = null;
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

    const matchedField = bestFieldMatch(rawFinal, fields);
    if (matchedField) {
      setFocusKey(matchedField.field_key);
      focusKeyRef.current = matchedField.field_key;
      setStatusMsg(`➡ ${matchedField.field_label} に切り替えました`);
      setMatchStatus("none");
      setMatches([]);
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

  const handleSaveRecord = () => {
    if (!selectedPatient) {
      setStatusMsg("❌ 利用者が選択されていません");
      return;
    }
    const params =
      screenKey === "daily_status"
        ? { screen_key: screenKey, patient_id: selectedPatient.id, record_date: recordDate, values: valuesRef.current }
        : { screen_key: screenKey, patient_id: selectedPatient.id, record_year_month: yearMonth, values: valuesRef.current };

    saveStatusRecord(params)
      .then(() => {
        setStatusMsg("✅ 保存しました");
        setMatches([]);
        setMatchStatus("none");
        setTranscript("");
        lastFinalRef.current = "";
      })
      .catch(() => setStatusMsg("❌ 保存に失敗しました"));
  };

  if (!selectedPatient) {
    return null;
  }

  return (
    <div className={styles.wrapper}>
      {/* Screen + date/month scope */}
      <div className={styles.scopeBar}>
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
        <button type="button" className="btn btn-sm btn-success ms-auto" onClick={handleSaveRecord}>
          保存
        </button>
      </div>

      <div className={styles.targetBox}>
        <label>対象フィールド</label>
        <select
          className={styles.presetSelect}
          value={focusKey}
          onChange={(e) => setFocusKey(e.target.value)}
        >
          {fields.map((f) => (
            <option key={f.field_key} value={f.field_key}>
              {f.field_label}
            </option>
          ))}
        </select>

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
      </div>

      <div className={styles.transcriptBox}>
        {transcript ? (
          <p>{transcript}</p>
        ) : (
          <p className={styles.placeholder}>
            マイクで話してください…（例：「完食」「よし」「コメント〜」「保存」）
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

      {matchStatus === "match" && (
        <div className="alert alert-success rounded-4 shadow-sm border-0 text-center">
          🎯 候補 {matches.length} 件の中から最適なものを選択しました
        </div>
      )}
      {matchStatus === "no-match" && (
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
    </div>
  );
}
