// app/patients/page.tsx
// 利用者選択 — paginated read-only list from mst_customer (pat_id = patient_id)

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Container,
  Row,
  Col,
  Card,
  Form,
  Button,
  Alert,
  Spinner,
  Badge,
} from "react-bootstrap";
import { PersonLinesFill, CheckCircleFill, PersonCircle } from "react-bootstrap-icons";
import Layout from "../components/layout/Layout";
import { usePatient } from "../context/PatientContext";
import {
  fetchPatients,
  fetchPatientAreas,
  Patient,
  PatientArea,
} from "../lib/statusApi";

const PAGE_SIZE = 50;

export default function PatientsPage() {
  const router = useRouter();
  const { selectedPatient, selectPatient } = usePatient();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [areas, setAreas] = useState<PatientArea[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  // Debounce search box → server query
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(t);
  }, [queryInput]);

  useEffect(() => {
    fetchPatientAreas()
      .then(setAreas)
      .catch((e) => console.error(e));
  }, []);

  const loadPage = useCallback(
    async (nextPage: number, append: boolean) => {
      if (append) {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const data = await fetchPatients({
          page: nextPage,
          limit: PAGE_SIZE,
          q: query || undefined,
          belong_area: areaFilter || undefined,
        });
        setPatients((prev) => (append ? [...prev, ...data.items] : data.items));
        setPage(data.page);
        setTotal(data.total);
        setHasMore(data.hasMore);
      } catch (e) {
        console.error(e);
        setMessage({ type: "error", text: "利用者一覧の読み込みに失敗しました" });
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [query, areaFilter]
  );

  // Reset list when filters change
  useEffect(() => {
    setPatients([]);
    setPage(1);
    setHasMore(false);
    loadPage(1, false);
  }, [loadPage]);

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          loadPage(page + 1, true);
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, loadingMore, page, loadPage]);

  const handleSelect = (p: Patient) => {
    selectPatient(p);
    router.push("/");
  };

  return (
    <Layout>
      <Container fluid className="py-2">
        <div className="d-flex align-items-center mb-4">
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
            <PersonLinesFill size={22} />
          </div>
          <div>
            <h1 className="h4 mb-0 fw-bold">利用者選択</h1>
            <p className="text-muted mb-0 small">
              顧客マスタから選択（patient_id = pat_id）。{total > 0 ? `${total} 件` : ""}
            </p>
          </div>
        </div>

        <Row className="justify-content-center">
          <Col lg={10} xl={8}>
            <Card>
              <Card.Body className="p-4">
                {message && (
                  <Alert
                    variant={message.type === "success" ? "success" : "danger"}
                    dismissible
                    onClose={() => setMessage(null)}
                  >
                    {message.text}
                  </Alert>
                )}

                <Row className="g-2 mb-3">
                  <Col md={7}>
                    <Form.Control
                      placeholder="名前・カナ・電話・住所・pat_id で検索"
                      value={queryInput}
                      onChange={(e) => setQueryInput(e.target.value)}
                    />
                  </Col>
                  <Col md={5}>
                    <Form.Select
                      value={areaFilter}
                      onChange={(e) => setAreaFilter(e.target.value)}
                    >
                      <option value="">すべてのエリア</option>
                      {areas.map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </Form.Select>
                  </Col>
                </Row>

                {loading ? (
                  <div className="text-center py-5">
                    <Spinner animation="border" />
                  </div>
                ) : patients.length === 0 ? (
                  <div className="text-center py-5 text-muted">
                    <PersonCircle size={36} className="mb-2 opacity-50" />
                    <div>該当する利用者がいません</div>
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {patients.map((p) => {
                      const isSelected = selectedPatient?.id === p.id;
                      const initial = (p.name || "?").charAt(0);
                      return (
                        <div
                          key={p.id}
                          className="d-flex justify-content-between align-items-center p-3 rounded-3"
                          style={{
                            border: `1px solid ${isSelected ? "var(--brand-300)" : "var(--border-color)"}`,
                            background: isSelected ? "var(--brand-50)" : "var(--primary-bg)",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <div className="d-flex align-items-center gap-3 min-w-0">
                            <div
                              className="d-flex align-items-center justify-content-center flex-shrink-0 fw-bold"
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: "50%",
                                background: isSelected
                                  ? "var(--gradient-primary)"
                                  : "var(--secondary-bg)",
                                color: isSelected ? "#fff" : "var(--secondary-text)",
                              }}
                            >
                              {initial}
                            </div>
                            <div className="min-w-0">
                              <div className="d-flex align-items-center gap-2 flex-wrap">
                                <span className="fw-semibold">{p.name}</span>
                                <Badge bg="light" text="dark" pill>
                                  pat_id {p.pat_id ?? p.id}
                                </Badge>
                                {p.belong_area_name && (
                                  <Badge bg="secondary" pill>
                                    {p.belong_area_name}
                                  </Badge>
                                )}
                                {isSelected && (
                                  <Badge
                                    bg="success"
                                    pill
                                    className="d-flex align-items-center gap-1"
                                  >
                                    <CheckCircleFill size={11} />
                                    選択中
                                  </Badge>
                                )}
                              </div>
                              {(p.customer_kana || p.customer_address1) && (
                                <div className="text-muted small text-truncate">
                                  {[p.customer_kana, p.customer_address1, p.customer_tel]
                                    .filter(Boolean)
                                    .join(" / ")}
                                </div>
                              )}
                            </div>
                          </div>
                          <Button
                            variant={isSelected ? "outline-success" : "outline-primary"}
                            size="sm"
                            className="flex-shrink-0"
                            onClick={() => handleSelect(p)}
                          >
                            選択
                          </Button>
                        </div>
                      );
                    })}

                    <div ref={sentinelRef} className="py-3 text-center">
                      {loadingMore && <Spinner animation="border" size="sm" />}
                      {!hasMore && patients.length > 0 && (
                        <div className="text-muted small">すべて表示しました</div>
                      )}
                      {hasMore && !loadingMore && (
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => loadPage(page + 1, true)}
                        >
                          さらに読み込む
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </Layout>
  );
}
