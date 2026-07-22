// app/patients/page.tsx

"use client";

import { useEffect, useState } from "react";
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
import { PersonLinesFill, Plus, Trash, CheckCircleFill, PersonCircle } from "react-bootstrap-icons";
import Layout from "../components/layout/Layout";
import { usePatient } from "../context/PatientContext";
import { fetchPatients, savePatient, deletePatient, Patient } from "../lib/statusApi";

export default function PatientsPage() {
  const router = useRouter();
  const { selectedPatient, selectPatient, clearPatient } = usePatient();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      const data = await fetchPatients();
      setPatients(data);
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "利用者一覧の読み込みに失敗しました" });
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      setLoading(true);
      await savePatient({ name: newName.trim() });
      setNewName("");
      setMessage({ type: "success", text: "利用者を登録しました" });
      await load();
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "登録に失敗しました" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (p: Patient) => {
    if (!confirm(`利用者「${p.name}」を削除しますか？`)) return;
    try {
      setLoading(true);
      await deletePatient(p.id);
      if (selectedPatient?.id === p.id) clearPatient();
      await load();
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "削除に失敗しました" });
    } finally {
      setLoading(false);
    }
  };

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
            <p className="text-muted mb-0 small">記録・報告の対象となる利用者を登録・選択します</p>
          </div>
        </div>

        <Row className="justify-content-center">
          <Col lg={8} xl={6}>
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

                <Form
                  className="d-flex gap-2 mb-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAdd();
                  }}
                >
                  <Form.Control
                    placeholder="新しい利用者名"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <Button variant="primary" type="submit" disabled={loading} className="text-nowrap flex-shrink-0">
                    <Plus className="me-1" />
                    追加
                  </Button>
                </Form>

                {loading ? (
                  <div className="text-center py-5">
                    <Spinner animation="border" />
                  </div>
                ) : patients.length === 0 ? (
                  <div className="text-center py-5 text-muted">
                    <PersonCircle size={36} className="mb-2 opacity-50" />
                    <div>利用者が登録されていません</div>
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {patients.map((p) => {
                      const isSelected = selectedPatient?.id === p.id;
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
                          <div className="d-flex align-items-center gap-3">
                            <div
                              className="d-flex align-items-center justify-content-center flex-shrink-0 fw-bold"
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: "50%",
                                background: isSelected ? "var(--gradient-primary)" : "var(--secondary-bg)",
                                color: isSelected ? "#fff" : "var(--secondary-text)",
                              }}
                            >
                              {p.name.charAt(0)}
                            </div>
                            <div className="d-flex align-items-center gap-2">
                              <span className="fw-semibold">{p.name}</span>
                              {isSelected && (
                                <Badge bg="success" pill className="d-flex align-items-center gap-1">
                                  <CheckCircleFill size={11} />
                                  選択中
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="d-flex gap-2">
                            <Button
                              variant={isSelected ? "outline-success" : "outline-primary"}
                              size="sm"
                              onClick={() => handleSelect(p)}
                            >
                              選択
                            </Button>
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => handleDelete(p)}
                            >
                              <Trash />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
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
