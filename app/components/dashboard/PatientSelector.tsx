// app/components/dashboard/PatientSelector.tsx
// Embedded 利用者選択 (user/patient selection) for the Status Input screen.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PersonCircle,
  CheckCircleFill,
  ChevronDown,
  Search,
} from "react-bootstrap-icons";
import styles from "@/app/styles/PatientSelector.module.css";
import { usePatient } from "@/app/context/PatientContext";
import { fetchPatients, fetchPatientAreas, Patient, PatientArea } from "@/app/lib/statusApi";

const PAGE_SIZE = 30;
const VOICE_MATCH_MAX_PAGES = 20;

function toHiragana(value: string) {
  return value.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

function normalizeVoiceText(value: string) {
  return toHiragana(value)
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/[ーｰ]/g, "")
    .replace(/[・･]/g, "")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

function scorePatientMatch(patient: Patient, spoken: string) {
  const normalizedSpoken = normalizeVoiceText(spoken);
  if (!normalizedSpoken) return -1;

  const patId = normalizeVoiceText(String(patient.pat_id ?? ""));
  const internalId = normalizeVoiceText(String(patient.id));
  const name = normalizeVoiceText(patient.name ?? "");
  const customerName = normalizeVoiceText(patient.customer_name ?? "");
  const customerKana = normalizeVoiceText(patient.customer_kana ?? "");
  const names = [name, customerName, customerKana].filter(Boolean);

  if (patId && normalizedSpoken === patId) return 140;
  if (internalId && normalizedSpoken === internalId) return 130;
  if (names.some((n) => n === normalizedSpoken)) return 120;
  if (patId && patId.includes(normalizedSpoken)) return 95;
  if (internalId && internalId.includes(normalizedSpoken)) return 90;
  if (names.some((n) => n.startsWith(normalizedSpoken))) return 85;
  if (names.some((n) => n.includes(normalizedSpoken))) return 75;

  return -1;
}

function findBestPatientMatchWithScore(patients: Patient[], spoken: string) {
  let best: { patient: Patient; score: number } | null = null;
  for (const patient of patients) {
    const score = scorePatientMatch(patient, spoken);
    if (score < 0) continue;
    if (!best || score > best.score) {
      best = { patient, score };
    }
  }
  return best;
}

type PatientSelectorProps = {
  externalVoiceText?: string;
  externalVoiceRequestId?: number;
  onExternalVoiceResult?: (result: { matched: boolean; message: string; patient?: Patient }) => void;
  locked?: boolean;
};

export default function PatientSelector({
  externalVoiceText,
  externalVoiceRequestId,
  onExternalVoiceResult,
  locked = false,
}: PatientSelectorProps) {
  const { selectedPatient, selectPatient } = usePatient();

  const [open, setOpen] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [areas, setAreas] = useState<PatientArea[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(t);
  }, [queryInput]);

  useEffect(() => {
    if (!open) return;
    fetchPatientAreas()
      .then(setAreas)
      .catch((e) => console.error(e));
  }, [open]);

  const loadPage = useCallback(
    async (nextPage: number, append: boolean) => {
      if (append && loadingMoreRef.current) return;
      if (append) loadingMoreRef.current = true;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const data = await fetchPatients({
          page: nextPage,
          limit: PAGE_SIZE,
          q: query || undefined,
          belong_area: areaFilter || undefined,
        });
        setPatients((prev) => (append ? [...prev, ...data.items] : data.items));
        setPage(data.page);
        setHasMore(data.hasMore);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [query, areaFilter]
  );

  useEffect(() => {
    if (!open) return;
    setPatients([]);
    setPage(1);
    setHasMore(false);
    loadPage(1, false);
  }, [open, loadPage]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (!open || !listSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!hasMore || loading || loadingMore) return;
        void loadPage(page + 1, true);
      },
      {
        root: listRef.current,
        rootMargin: "120px 0px",
        threshold: 0,
      }
    );
    observer.observe(listSentinelRef.current);
    return () => observer.disconnect();
  }, [open, hasMore, loading, loadingMore, loadPage, page]);

  const handleSelect = (p: Patient) => {
    selectPatient(p);
    setOpen(false);
    setVoiceStatus(`${p.name} を選択しました`);
    onExternalVoiceResult?.({ matched: true, message: `${p.name} を選択しました`, patient: p });
  };

  const trySelectByVoiceText = async (spokenRaw: string) => {
    const spoken = spokenRaw.trim();
    if (!spoken) {
      const message = "音声を認識できませんでした";
      setVoiceStatus(message);
      onExternalVoiceResult?.({ matched: false, message });
      return;
    }

    setQueryInput(spoken);
    setVoiceStatus(`音声: ${spoken} / 検索中...`);

    try {
      const candidateMap = new Map<number, Patient>(patients.map((p) => [p.id, p]));

      const collectCandidates = async (q?: string) => {
        let nextPage = 1;
        let hasMorePages = true;
        while (hasMorePages && nextPage <= VOICE_MATCH_MAX_PAGES) {
          const result = await fetchPatients({
            page: nextPage,
            limit: PAGE_SIZE,
            q,
            belong_area: areaFilter || undefined,
          });
          for (const patient of result.items) {
            candidateMap.set(patient.id, patient);
          }
          const scored = findBestPatientMatchWithScore(Array.from(candidateMap.values()), spoken);
          if (scored && scored.score >= 120) return scored;
          hasMorePages = result.hasMore;
          nextPage += 1;
        }
        return findBestPatientMatchWithScore(Array.from(candidateMap.values()), spoken);
      };

      let bestMatch = await collectCandidates(spoken);
      if (!bestMatch) {
        setVoiceStatus(`音声: ${spoken} / 全利用者を検索中...`);
        bestMatch = await collectCandidates(undefined);
      }

      if (bestMatch?.patient) {
        handleSelect(bestMatch.patient);
      } else {
        const message = "一致する利用者が見つかりませんでした";
        setVoiceStatus(message);
        onExternalVoiceResult?.({ matched: false, message });
      }
    } catch (e) {
      console.error(e);
      const message = "音声検索に失敗しました";
      setVoiceStatus(message);
      onExternalVoiceResult?.({ matched: false, message });
    }
  };

  useEffect(() => {
    if (!externalVoiceRequestId || !externalVoiceText) return;
    void trySelectByVoiceText(externalVoiceText);
  }, [externalVoiceRequestId, externalVoiceText]);

  useEffect(() => {
    if (locked) setOpen(false);
  }, [locked]);

  return (
    <div className={styles.wrapper} ref={containerRef}>
      <label className={styles.label}>対象利用者</label>
      <button
        type="button"
        className={`${styles.trigger} ${locked ? styles.triggerLocked : ""}`}
        onClick={() => !locked && setOpen((v) => !v)}
        disabled={locked}
        title={locked ? "対象フィールドを「利用者選択」にすると変更できます" : undefined}
      >
        <PersonCircle size={18} />
        <span className={styles.triggerText}>
          {selectedPatient ? selectedPatient.name : "利用者を選択してください"}
        </span>
        <ChevronDown size={14} className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
      </button>

      {open && !locked && (
        <div className={styles.panel}>
          <div className={styles.filters}>
            <div className={styles.searchBox}>
              <Search size={14} />
              <input
                autoFocus
                placeholder="ひらがな・pat_id で検索"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
              />
            </div>
            <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
              <option value="">すべてのエリア</option>
              {areas.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          {!!voiceStatus && <div className={styles.voiceStatus}>{voiceStatus}</div>}

          <div className={styles.list} ref={listRef}>
            {loading ? (
              <div className={styles.centerMsg}>読み込み中…</div>
            ) : patients.length === 0 ? (
              <div className={styles.centerMsg}>該当する利用者がいません</div>
            ) : (
              <>
                {patients.map((p) => {
                  const isSelected = selectedPatient?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`${styles.item} ${isSelected ? styles.itemSelected : ""}`}
                      onClick={() => handleSelect(p)}
                    >
                      <span className={styles.itemName}>{p.name}</span>
                      <span className={styles.itemMeta}>
                        pat_id {p.pat_id ?? p.id}
                        {p.belong_area_name ? ` ・ ${p.belong_area_name}` : ""}
                      </span>
                      {isSelected && <CheckCircleFill size={14} className={styles.itemCheck} />}
                    </button>
                  );
                })}
                <div ref={listSentinelRef} className={styles.listSentinel} aria-hidden="true" />
                {hasMore && (
                  <button
                    type="button"
                    className={styles.loadMore}
                    onClick={() => loadPage(page + 1, true)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "読み込み中…" : "さらに読み込む"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
