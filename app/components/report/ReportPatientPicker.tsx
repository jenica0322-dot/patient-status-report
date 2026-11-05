// app/components/report/ReportPatientPicker.tsx
// 報告書's own 対象者 dropdown. Picking someone here only changes which report
// is shown — it never touches the app-wide selected patient (PatientContext)
// that Status Input is recording for.
"use client";

import { useEffect, useRef, useState } from "react";
import { Search, PersonCircle } from "react-bootstrap-icons";
import { fetchPatients, Patient } from "@/app/lib/statusApi";
import styles from "@/app/styles/MonthlyReportGrid.module.css";

const PAGE_SIZE = 50;

type Props = {
  value: { id: number; name: string } | null;
  onChange: (patient: Patient) => void;
  className?: string;
};

export default function ReportPatientPicker({ value, onChange, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Patient[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load (debounced) whenever the panel is open and the search text changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      setError(false);
      fetchPatients({ q: query.trim() || undefined, limit: PAGE_SIZE, count: false })
        .then((page) => {
          if (cancelled) return;
          setItems(page.items);
          setHasMore(page.hasMore);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.patientPicker} ref={rootRef}>
      <button
        type="button"
        className={`form-select text-start fw-bold ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {value ? value.name : <span className="text-muted fw-normal">対象者を選択</span>}
      </button>
      {open && (
        <div className={styles.patientPickerPanel}>
          <div className={styles.patientPickerSearch}>
            <Search size={14} />
            <input
              ref={searchRef}
              type="search"
              className="form-control form-control-sm"
              placeholder="名前・ふりがな・pat_id で検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.patientPickerList} role="listbox">
            {loading && items.length === 0 && <div className={styles.patientPickerNote}>読み込み中…</div>}
            {error && <div className={styles.patientPickerNote}>利用者の読み込みに失敗しました</div>}
            {!loading && !error && items.length === 0 && (
              <div className={styles.patientPickerNote}>該当する利用者がいません</div>
            )}
            {items.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={value?.id === p.id}
                className={`${styles.patientPickerOption} ${value?.id === p.id ? styles.patientPickerOptionActive : ""}`}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
              >
                <PersonCircle size={14} className="flex-shrink-0" />
                <span>{p.name}</span>
                {p.pat_id != null && <span className={styles.patientPickerId}>{p.pat_id}</span>}
              </button>
            ))}
            {hasMore && <div className={styles.patientPickerNote}>さらに表示するには検索で絞り込んでください</div>}
          </div>
        </div>
      )}
    </div>
  );
}
