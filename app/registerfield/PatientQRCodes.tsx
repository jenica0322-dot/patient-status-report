// app/registerfield/PatientQRCodes.tsx
// マスター → 利用者QRコード tab: every listed patient is shown with a QR code
// whose content is the bare pat_id. That is the format Status Input's QR scan
// reads first (parseTargetUserId → digits-only payload), so a printed code
// selects the same patient there. Checkboxes only choose what to print.
"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Card, Form, Button, Spinner, Alert, InputGroup } from "react-bootstrap";
import { Search, Printer, Download } from "react-bootstrap-icons";
import { fetchPatients, fetchPatientAreas, Patient, PatientArea } from "@/app/lib/statusApi";

const PAGE_SIZE = 30;
const QR_SIZE = 240;

type QrEntry = { patId: string; name: string; kana: string; dataUrl: string | null };

const patIdOf = (p: Patient) => (p.pat_id != null && String(p.pat_id).trim() ? String(p.pat_id).trim() : null);

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const toEntry = async (p: Patient): Promise<QrEntry | null> => {
  const patId = patIdOf(p);
  if (!patId) return null;
  const name = p.customer_name || p.name || "";
  const kana = p.customer_kana || "";
  try {
    const dataUrl = await QRCode.toDataURL(patId, { width: QR_SIZE, margin: 2, errorCorrectionLevel: "M" });
    return { patId, name, kana, dataUrl };
  } catch (e) {
    console.error(e);
    return { patId, name, kana, dataUrl: null };
  }
};

export default function PatientQRCodes() {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [area, setArea] = useState("");
  const [areas, setAreas] = useState<PatientArea[]>([]);
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<QrEntry[]>([]);
  const [noIdCount, setNoIdCount] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Picked for printing, keyed by pat_id. Kept across pages / searches, in pick order.
  const [toPrint, setToPrint] = useState<Map<string, QrEntry>>(new Map());

  useEffect(() => {
    fetchPatientAreas().then(setAreas).catch(() => setAreas([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPatients({ page, limit: PAGE_SIZE, q: appliedQuery || undefined, belong_area: area || undefined })
      .then(async (res) => {
        const built = (await Promise.all(res.items.map(toEntry))).filter((e): e is QrEntry => e !== null);
        if (cancelled) return;
        setEntries(built);
        setNoIdCount(res.items.length - built.length);
        setTotal(res.total);
        setHasMore(res.hasMore);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError("利用者一覧の取得に失敗しました");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, appliedQuery, area]);

  const toggle = (q: QrEntry) =>
    setToPrint((prev) => {
      const next = new Map(prev);
      if (next.has(q.patId)) next.delete(q.patId);
      else next.set(q.patId, q);
      return next;
    });

  const printable = entries.filter((q) => q.dataUrl);
  const allPageSelected = printable.length > 0 && printable.every((q) => toPrint.has(q.patId));
  const togglePage = () =>
    setToPrint((prev) => {
      const next = new Map(prev);
      for (const q of printable) {
        if (allPageSelected) next.delete(q.patId);
        else if (!next.has(q.patId)) next.set(q.patId, q);
      }
      return next;
    });

  const download = (q: QrEntry) => {
    if (!q.dataUrl) return;
    const a = document.createElement("a");
    a.href = q.dataUrl;
    a.download = `QR_${q.patId}.png`;
    a.click();
  };

  const print = () => {
    const list = [...toPrint.values()];
    if (list.length === 0) return;
    const w = window.open("", "_blank");
    if (!w) {
      setError("印刷ウィンドウを開けませんでした（ポップアップを許可してください）");
      return;
    }
    const cards = list
      .map(
        (q) =>
          `<div class="card"><img src="${q.dataUrl}" alt="" /><div class="name">${escapeHtml(q.name)}</div><div class="id">ID: ${escapeHtml(q.patId)}</div></div>`,
      )
      .join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>利用者QRコード</title><style>
      body{font-family:sans-serif;margin:12mm}
      .grid{display:flex;flex-wrap:wrap;gap:6mm}
      .card{width:55mm;border:1px dashed #999;padding:4mm;text-align:center;break-inside:avoid}
      .card img{width:45mm;height:45mm}
      .name{font-size:13pt;font-weight:bold;margin-top:2mm;word-break:break-all}
      .id{font-size:11pt;color:#333}
    </style></head><body><div class="grid">${cards}</div>
    <script>window.onload=function(){window.print();}</script></body></html>`);
    w.document.close();
  };

  const totalPages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null;

  return (
    <Card>
      <Card.Body>
        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
          <Form
            className="d-flex"
            style={{ flex: "1 1 240px" }}
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setAppliedQuery(query.trim());
            }}
          >
            <InputGroup>
              <Form.Control placeholder="氏名・カナ・IDで検索" value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button type="submit" variant="outline-primary" aria-label="検索">
                <Search />
              </Button>
            </InputGroup>
          </Form>
          {areas.length > 0 && (
            <Form.Select
              style={{ flex: "0 1 200px" }}
              value={area}
              onChange={(e) => {
                setPage(1);
                setArea(e.target.value);
              }}
            >
              <option value="">全エリア</option>
              {areas.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}
                </option>
              ))}
            </Form.Select>
          )}
          <div className="ms-auto d-flex flex-wrap gap-2 align-items-center justify-content-end">
            <Form.Check
              id="qr-select-page"
              label="このページを全選択"
              checked={allPageSelected}
              disabled={printable.length === 0 || loading}
              onChange={togglePage}
            />
            {toPrint.size > 0 && (
              <Button size="sm" variant="outline-secondary" onClick={() => setToPrint(new Map())}>
                選択解除
              </Button>
            )}
            <Button variant="primary" disabled={toPrint.size === 0} onClick={print}>
              <Printer className="me-1" />
              印刷（{toPrint.size}件）
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-5">
            <Spinner animation="border" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-muted text-center py-5 mb-0">
            {noIdCount > 0 ? "このページの利用者にはIDがありません" : "該当する利用者がいません"}
          </p>
        ) : (
          <div className="d-flex flex-wrap gap-3 justify-content-center">
            {entries.map((q) => {
              const checked = toPrint.has(q.patId);
              return (
                <div
                  key={q.patId}
                  className={`border rounded p-2 text-center ${checked ? "border-primary border-2 bg-primary-subtle" : ""}`}
                  style={{ width: 180, cursor: q.dataUrl ? "pointer" : "default" }}
                  onClick={() => q.dataUrl && toggle(q)}
                >
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <Form.Check
                      aria-label={`${q.name}を印刷対象にする`}
                      checked={checked}
                      disabled={!q.dataUrl}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(q)}
                    />
                    <Button
                      size="sm"
                      variant="link"
                      className="p-0"
                      disabled={!q.dataUrl}
                      title="PNGで保存"
                      onClick={(e) => {
                        e.stopPropagation();
                        download(q);
                      }}
                    >
                      <Download />
                    </Button>
                  </div>
                  {q.dataUrl ? (
                    <img src={q.dataUrl} alt={`QR ${q.patId}`} width={150} height={150} />
                  ) : (
                    <div className="text-danger small d-flex align-items-center justify-content-center" style={{ height: 150 }}>
                      生成失敗
                    </div>
                  )}
                  <div className="fw-bold text-break">{q.name}</div>
                  {q.kana && <div className="small text-muted text-break">{q.kana}</div>}
                  <div className="small text-muted">ID: {q.patId}</div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && noIdCount > 0 && entries.length > 0 && (
          <p className="small text-muted text-center mt-2 mb-0">IDのない利用者 {noIdCount}件 は表示していません</p>
        )}

        <div className="d-flex justify-content-between align-items-center mt-3">
          <Button size="sm" variant="outline-secondary" disabled={page <= 1 || loading} onClick={() => setPage((n) => n - 1)}>
            前へ
          </Button>
          <span className="small text-muted">
            {page}
            {totalPages != null ? ` / ${totalPages}` : ""} ページ{total != null ? `（${total}件）` : ""}
          </span>
          <Button size="sm" variant="outline-secondary" disabled={!hasMore || loading} onClick={() => setPage((n) => n + 1)}>
            次へ
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}
