// app/registerfield/registerFields.tsx
"use client";

import React, { useEffect, useState } from "react";
import {
  Container,
  Row,
  Col,
  Card,
  Form,
  Button,
  Table,
  Badge,
  Alert,
  Spinner,
  InputGroup,
} from "react-bootstrap";
import {
  FileText,
  Plus,
  Trash,
  Pencil,
  Check,
  Database,
  List,
} from "react-bootstrap-icons";
import {
  fetchStatusFields,
  saveStatusField,
  deleteStatusField,
} from "@/app/lib/statusApi";

interface Field {
  screen_key: string;
  field_key: string;
  field_label: string;
  field_type: string;
  phrases: string[];
  order_index: number;
}

const SCREENS = [
  { key: "daily_status", label: "日次記録" },
  { key: "monthly_report", label: "月次報告" },
];

export default function RegisterFields() {
  const [fields, setFields] = useState<Field[]>([]);
  const [form, setForm] = useState<Field>({
    screen_key: "daily_status",
    field_key: "",
    field_label: "",
    field_type: "text",
    phrases: [],
    order_index: 0,
  });
  const [newPhrase, setNewPhrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadFields();
  }, [form.screen_key]);

  const loadFields = async () => {
    try {
      setLoading(true);
      const data = await fetchStatusFields(form.screen_key);
      setFields(data);
    } catch (err) {
      console.error("Failed to load fields:", err);
      setMessage({ type: "error", text: "Failed to load fields" });
    } finally {
      setLoading(false);
    }
  };

  const handleScreenChange = (screenKey: string) => {
    setForm({
      screen_key: screenKey,
      field_key: "",
      field_label: "",
      field_type: "text",
      phrases: [],
      order_index: 0,
    });
  };

  const handleSave = async () => {
    if (!form.field_key.trim()) {
      setMessage({ type: "error", text: "Field key is required" });
      return;
    }
    try {
      setLoading(true);
      setMessage(null);
      await saveStatusField(form);
      setMessage({ type: "success", text: "Field saved successfully!" });
      await loadFields();

      setForm({
        screen_key: form.screen_key,
        field_key: "",
        field_label: "",
        field_type: "text",
        phrases: [],
        order_index: 0,
      });
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "Failed to save field" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (f: Field) => {
    if (!confirm(`Delete field "${f.field_label}"?`)) return;
    try {
      setLoading(true);
      await deleteStatusField(f.screen_key, f.field_key);
      setFields((prev) =>
        prev.filter(
          (x) => !(x.field_key === f.field_key && x.screen_key === f.screen_key)
        )
      );
      setMessage({ type: "success", text: "Field deleted successfully!" });
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "Failed to delete field" });
    } finally {
      setLoading(false);
    }
  };

  const addPhrase = () => {
    if (!newPhrase.trim()) return;
    const updatedPhrases = [...form.phrases, newPhrase.trim()];
    setForm({ ...form, phrases: updatedPhrases });
    setNewPhrase("");
  };

  const removePhrase = (p: string) => {
    setForm({ ...form, phrases: form.phrases.filter((x) => x !== p) });
  };

  return (
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
          <h1 className="h4 mb-0 fw-bold">フィールド登録・管理</h1>
          <p className="text-muted mb-0 small">記録項目のマスターデータを管理します</p>
        </div>
      </div>

      <Row className="justify-content-center">
        <Col lg={11} xl={10}>
          <Card>
            <Card.Body>
              {message && (
                <Alert variant={message.type === "success" ? "success" : "danger"} dismissible onClose={() => setMessage(null)}>
                  {message.text}
                </Alert>
              )}

              <Form.Group className="mb-4">
                <Form.Label>画面</Form.Label>
                <div className="d-flex gap-2">
                  {SCREENS.map((s) => (
                    <Button
                      key={s.key}
                      variant={form.screen_key === s.key ? "primary" : "outline-primary"}
                      onClick={() => handleScreenChange(s.key)}
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
              </Form.Group>

              <Row>
                <Col md={7}>
                  <Card className="mb-4">
                    <Card.Header>
                      <Database className="me-2" />
                      フィールド情報
                    </Card.Header>
                    <Card.Body>
                      <Form>
                        <Row className="mb-3">
                          <Col md={6}>
                            <Form.Group>
                              <Form.Label>フィールドキー</Form.Label>
                              <Form.Control
                                type="text"
                                value={form.field_key}
                                onChange={(e) => setForm({ ...form, field_key: e.target.value })}
                                placeholder="ユニークなキー (例: kanshoku)"
                                required
                              />
                            </Form.Group>
                          </Col>
                          <Col md={6}>
                            <Form.Group>
                              <Form.Label>表示順</Form.Label>
                              <Form.Control
                                type="number"
                                value={form.order_index}
                                onChange={(e) => setForm({ ...form, order_index: Number(e.target.value) })}
                                min="0"
                              />
                            </Form.Group>
                          </Col>
                        </Row>

                        <Row className="mb-3">
                          <Col md={8}>
                            <Form.Group>
                              <Form.Label>ラベル</Form.Label>
                              <Form.Control
                                type="text"
                                value={form.field_label}
                                onChange={(e) => setForm({ ...form, field_label: e.target.value })}
                                placeholder="表示される名前 (例: 完食)"
                              />
                            </Form.Group>
                          </Col>
                          <Col md={4}>
                            <Form.Group>
                              <Form.Label>フィールドタイプ</Form.Label>
                              <Form.Select
                                value={form.field_type}
                                onChange={(e) => setForm({ ...form, field_type: e.target.value })}
                              >
                                <option value="text">テキスト</option>
                                <option value="checkbox">チェック</option>
                                <option value="preset">プリセット</option>
                              </Form.Select>
                            </Form.Group>
                          </Col>
                        </Row>

                        {form.field_type === "preset" && (
                          <Card className="mb-3" style={{ background: "var(--secondary-bg)" }}>
                            <Card.Header>
                              <List className="me-2" />
                              フレーズ管理
                            </Card.Header>
                            <Card.Body>
                              {form.phrases.length > 0 && (
                                <div className="mb-3">
                                  <h6 className="text-muted small text-uppercase mb-2">登録済みフレーズ</h6>
                                  <div className="d-flex flex-wrap gap-2">
                                    {form.phrases.map((p, idx) => (
                                      <Badge
                                        key={idx}
                                        bg="primary"
                                        className="d-flex align-items-center gap-1 py-2 px-3"
                                        style={{ fontWeight: 500 }}
                                      >
                                        {p}
                                        <button
                                          type="button"
                                          className="btn-close btn-close-white"
                                          style={{ fontSize: "0.55rem" }}
                                          aria-label="削除"
                                          onClick={() => removePhrase(p)}
                                        />
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <InputGroup>
                                <Form.Control
                                  placeholder="新しいフレーズを追加"
                                  value={newPhrase}
                                  onChange={(e) => setNewPhrase(e.target.value)}
                                  onKeyPress={(e) => e.key === "Enter" && addPhrase()}
                                />
                                <Button variant="outline-primary" onClick={addPhrase}>
                                  <Plus />
                                </Button>
                              </InputGroup>
                            </Card.Body>
                          </Card>
                        )}

                        <div className="d-grid">
                          <Button
                            variant="primary"
                            size="lg"
                            onClick={handleSave}
                            disabled={loading}
                          >
                            {loading ? (
                              <span key="loading">
                                <Spinner animation="border" size="sm" className="me-2" />
                                保存中...
                              </span>
                            ) : (
                              <span key="idle">
                                <Check className="me-2" />
                                保存
                              </span>
                            )}
                          </Button>
                        </div>
                      </Form>
                    </Card.Body>
                  </Card>
                </Col>

                <Col md={5}>
                  <Card>
                    <Card.Header>
                      <List className="me-2" />
                      登録済みフィールド ({fields.length})
                    </Card.Header>
                    <Card.Body className="p-0">
                      {loading ? (
                        <div className="text-center py-4">
                          <Spinner animation="border" />
                        </div>
                      ) : fields.length === 0 ? (
                        <div className="text-center py-4 text-muted">
                          フィールドがありません
                        </div>
                      ) : (
                        <div className="list-group list-group-flush">
                          {fields.map((f) => (
                            <div key={`${f.screen_key}-${f.field_key}`} className="list-group-item">
                              <div className="d-flex justify-content-between align-items-start">
                                <div className="flex-grow-1 me-2" style={{ minWidth: 0 }}>
                                  <h6 className="mb-1">{f.field_label}</h6>
                                  <small className="text-muted">
                                    {f.field_key} • {f.field_type}
                                    {f.phrases?.length > 0 && ` • ${f.phrases.length}フレーズ`}
                                  </small>
                                </div>
                                <div className="flex-shrink-0 d-flex">
                                  <Button
                                    variant="outline-primary"
                                    size="sm"
                                    className="me-1"
                                    onClick={() => setForm(f)}
                                  >
                                    <Pencil />
                                  </Button>
                                  <Button
                                    variant="outline-danger"
                                    size="sm"
                                    onClick={() => handleDelete(f)}
                                  >
                                    <Trash />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
