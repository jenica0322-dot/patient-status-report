// app/components/dashboard/PatientSelector.tsx
// Embedded 利用者選択 (user/patient selection) for the Status Input screen.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PersonCircle, CheckCircleFill, ChevronDown, Search } from "react-bootstrap-icons";
import styles from "@/app/styles/PatientSelector.module.css";
import { usePatient } from "@/app/context/PatientContext";
import { fetchPatients, fetchPatientAreas, Patient, PatientArea } from "@/app/lib/statusApi";

const PAGE_SIZE = 30;

export default function PatientSelector() {
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

  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const handleSelect = (p: Patient) => {
    selectPatient(p);
    setOpen(false);
  };

  return (
    <div className={styles.wrapper} ref={containerRef}>
      <label className={styles.label}>対象利用者</label>
      <button type="button" className={styles.trigger} onClick={() => setOpen((v) => !v)}>
        <PersonCircle size={18} />
        <span className={styles.triggerText}>
          {selectedPatient ? selectedPatient.name : "利用者を選択してください"}
        </span>
        <ChevronDown size={14} className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.filters}>
            <div className={styles.searchBox}>
              <Search size={14} />
              <input
                autoFocus
                placeholder="名前・カナ・pat_id で検索"
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

          <div className={styles.list}>
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
