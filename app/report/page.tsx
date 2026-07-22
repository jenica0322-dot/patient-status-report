// app/report/page.tsx

"use client";

import { useEffect, useState, useMemo } from "react";
import { Container, Row, Col, Card, Form, Badge, Table, Spinner, Alert } from "react-bootstrap";
import { FileText, Calendar } from "react-bootstrap-icons";
import Layout from "../components/layout/Layout";
import { usePatient } from "../context/PatientContext";
import {
  fetchPatients,
  fetchStatusFields,
  fetchPatientReport,
  Patient,
} from "../lib/statusApi";

interface Field {
  field_key: string;
  field_label: string;
  field_type: string;
  phrases: string[];
  order_index: number;
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function formatValue(v: any) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "object") {
    if (v.value === true) return "✓";
    if (v.value === false || v.value === undefined) return v.comment || "";
    return String(v.value) + (v.comment ? `（${v.comment}）` : "");
  }
  return String(v);
}

export default function ReportPage() {
  const { selectedPatient } = usePatient();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState<number | null>(selectedPatient?.id ?? null);
  const [yearMonth, setYearMonth] = useState(currentYearMonth());

  const [dailyFields, setDailyFields] = useState<Field[]>([]);
  const [monthlyFields, setMonthlyFields] = useState<Field[]>([]);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPatients().then(setPatients).catch(() => {});
    fetchStatusFields("daily_status").then(setDailyFields).catch(() => {});
    fetchStatusFields("monthly_report").then(setMonthlyFields).catch(() => {});
  }, []);

  useEffect(() => {
    if (!patientId) return;
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

  const dailyColumns = useMemo(
    () => dailyFields.slice().sort((a, b) => a.order_index - b.order_index),
    [dailyFields]
  );
  const monthlyOrdered = useMemo(
    () => monthlyFields.slice().sort((a, b) => a.order_index - b.order_index),
    [monthlyFields]
  );

  const tallyLabel = (key: string) =>
    dailyFields.find((f) => f.field_key === key)?.field_label || key;

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
            <FileText size={22} />
          </div>
          <div>
            <h1 className="h4 mb-0 fw-bold">報告書</h1>
            <p className="text-muted mb-0 small">利用者ごとの月次状況記録表兼報告書</p>
          </div>
        </div>

        <Card className="mb-4">
          <Card.Body>
            <Row className="g-3 align-items-end">
              <Col md={5}>
                <Form.Label>利用者</Form.Label>
                <Form.Select
                  value={patientId ?? ""}
                  onChange={(e) => setPatientId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">選択してください</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label>
                  <Calendar className="me-1" />
                  記録月
                </Form.Label>
                <Form.Control
                  type="month"
                  value={yearMonth}
                  onChange={(e) => setYearMonth(e.target.value)}
                />
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
            <Card.Body className="text-muted">利用者を選択してください</Card.Body>
          </Card>
        )}

        {!loading && report && (
          <>
            <Card className="mb-4">
              <Card.Header>
                {report.patient.name} さん — {report.yearMonth} 日次記録
              </Card.Header>
              <Card.Body className="p-0">
                <div className="table-responsive">
                  <Table hover size="sm" className="mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>日付</th>
                        {dailyColumns.map((f) => (
                          <th key={f.field_key}>{f.field_label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.days.length === 0 ? (
                        <tr>
                          <td colSpan={dailyColumns.length + 1} className="text-center text-muted py-4">
                            この月の記録はまだありません
                          </td>
                        </tr>
                      ) : (
                        report.days.map((day: any) => (
                          <tr key={day.record_date}>
                            <td className="fw-semibold">{formatDate(day.record_date)}</td>
                            {dailyColumns.map((f) => (
                              <td key={f.field_key}>{formatValue(day.values?.[f.field_key])}</td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </Table>
                </div>
              </Card.Body>
            </Card>

            <Card className="mb-4">
              <Card.Header>月次集計</Card.Header>
              <Card.Body>
                <Row className="g-3">
                  {Object.entries(report.tallies).map(([group, counts]: [string, any]) => (
                    <Col md={3} key={group}>
                      <div
                        className="rounded-3 p-3 h-100"
                        style={{ background: "var(--secondary-bg)", border: "1px solid var(--border-color)" }}
                      >
                        <div className="fw-semibold mb-2 text-truncate">{group}</div>
                        {Object.entries(counts).map(([key, count]) => (
                          <div key={key} className="d-flex justify-content-between align-items-center mb-1">
                            <span className="text-muted small">{tallyLabel(key)}</span>
                            <Badge bg="primary" pill>
                              {String(count)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </Col>
                  ))}
                </Row>
              </Card.Body>
            </Card>

            <Card className="mb-4">
              <Card.Header>月次報告欄</Card.Header>
              <Card.Body>
                {!report.monthlyReport ? (
                  <div className="text-muted text-center py-3">
                    この月の月次報告はまだ入力されていません
                  </div>
                ) : (
                  <div className="list-group list-group-flush">
                    {monthlyOrdered.map((f) => {
                      const v = report.monthlyReport?.[f.field_key];
                      if (v === undefined) return null;
                      return (
                        <div key={f.field_key} className="list-group-item px-0">
                          <div className="fw-semibold small text-muted">{f.field_label}</div>
                          <div>{formatValue(v) || <span className="text-muted">-</span>}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card.Body>
            </Card>
          </>
        )}
      </Container>
    </Layout>
  );
}
