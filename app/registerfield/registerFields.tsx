// app/registerfield/registerFields.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import ReportLayoutSettings from "./ReportLayoutSettings";
import GroupFieldEditor from "./GroupFieldEditor";
import UketoriEditor from "./UketoriEditor";
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
import {
  TARGET_GROUP_DEFS,
  TARGET_GROUP_SCREEN_KEY,
  UKETORI_FIELD_KEY,
  storedGroupLabel,
  storedGroupOptions,
  uketoriLabel,
  uketoriOptions,
} from "@/app/lib/targetFields";

// 日次記録 main categories shown in the 登録済みフィールド list: うけとり (its
// own master row, options editable) and 食べ残し / 体調 (each option saves
// into a report column). All three are editable. The other daily
// status_fields rows stay in the DB as report columns but aren't listed.
type MasterEntry =
  | { kind: "field"; field: Field; order: number }
  | { kind: "group"; field_key: string; field_label: string; options: string[]; multiple?: boolean; order: number };

function buildDailyEntries(fields: Field[], groupRows: Field[]): MasterEntry[] {
  const entries: MasterEntry[] = [];
  const uketori = fields.find((f) => f.field_key === UKETORI_FIELD_KEY);
  if (uketori) entries.push({ kind: "field", field: uketori, order: uketori.order_index });
  for (const def of TARGET_GROUP_DEFS) {
    const anchor = fields.find((f) => f.field_key === def.anchorKey);
    entries.push({
      kind: "group",
      field_key: def.field_key,
      field_label: storedGroupLabel(def.field_key, groupRows),
      options: storedGroupOptions(def.field_key, groupRows).flatMap((o) =>
        o.sub?.length ? o.sub.map((x) => `${o.label}：${x}`) : [o.label]
      ),
      multiple: def.multiple,
      order: anchor?.order_index ?? Number.MAX_SAFE_INTEGER,
    });
  }
  return entries.sort((a, b) => a.order - b.order);
}

interface Field {
  screen_key: string;
  field_key: string;
  field_label: string;
  field_type: string;
  phrases: string[];
  order_index: number;
}

// 月次報告 is no longer edited here (its tab was removed, same as on Status
// Input). Its master rows stay in the DB — the 報告書 still uses them.
const SCREENS = [
  { key: "daily_status", label: "日次記録" },
];

// Third tab next to the screens: the 報告書's comment-block / footer layout.
const LAYOUT_TAB = "report_layout";

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
  const [layoutTab, setLayoutTab] = useState(false);
  const [groupRows, setGroupRows] = useState<Field[]>([]);
  // 食べ残し / 体調 being edited (its field_key), or null for the normal form.
  // うけとり / 食べ残し / 体調 being edited (its field_key), or null for the
  // normal form.
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const editingLabel = editingGroup
    ? editingGroup === UKETORI_FIELD_KEY
      ? uketoriLabel(groupRows)
      : storedGroupLabel(editingGroup, groupRows)
    : "";
  const uketoriField = fields.find((f) => f.field_key === UKETORI_FIELD_KEY);
  const isDaily = form.screen_key === "daily_status";
  const dailyEntries = isDaily ? buildDailyEntries(fields, groupRows) : [];
  const layoutDirtyRef = useRef(false);
  // Leaving the 報告書レイアウト tab with unsaved edits asks first.
  const leaveLayoutTab = () => {
    if (layoutTab && layoutDirtyRef.current && !confirm("報告書レイアウトの保存していない変更を破棄しますか？")) return false;
    layoutDirtyRef.current = false;
    setLayoutTab(false);
    return true;
  };

  useEffect(() => {
    loadFields();
  }, [form.screen_key]);

  const loadFields = async () => {
    try {
      setLoading(true);
      const data = await fetchStatusFields(form.screen_key);
      setFields(data);
      if (form.screen_key === "daily_status") {
        setGroupRows(await fetchStatusFields(TARGET_GROUP_SCREEN_KEY).catch(() => []));
      }
    } catch (err) {
      console.error("Failed to load fields:", err);
      setMessage({ type: "error", text: "Failed to load fields" });
    } finally {
      setLoading(false);
    }
  };

  const handleScreenChange = (screenKey: string) => {
    setEditingGroup(null);
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
      <div className="d-flex align-items-center mb-3">
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

              <Form.Group className="mb-3">
                <Form.Label>画面</Form.Label>
                <div className="d-flex flex-wrap gap-2">
                  {SCREENS.map((s) => (
                    <Button
                      key={s.key}
                      variant={!layoutTab && form.screen_key === s.key ? "primary" : "outline-primary"}
                      onClick={() => {
                        if (!leaveLayoutTab()) return;
                        if (form.screen_key !== s.key) handleScreenChange(s.key);
                      }}
                      style={{ fontSize: 18 }}
                    >
                      {s.label}
                    </Button>
                  ))}
                  <Button
                    key={LAYOUT_TAB}
                    variant={layoutTab ? "primary" : "outline-primary"}
                    onClick={() => {
                      setMessage(null);
                      setLayoutTab(true);
                    }}
                    style={{ fontSize: 18 }}
                  >
                    報告書レイアウト
                  </Button>
                </div>
              </Form.Group>

              {layoutTab ? (
                <ReportLayoutSettings onDirtyChange={(d) => (layoutDirtyRef.current = d)} />
              ) : (
              <Row>
                <Col md={7}>
                  <Card className="mb-3 mb-md-0">
                    <Card.Header style={{ fontSize: 18 }}>
                      <Database className="me-2" />
                      フィールド情報
                      {editingGroup && <span key="editing-group">（{editingLabel}）</span>}
                    </Card.Header>
                    <Card.Body>
                      {editingGroup === UKETORI_FIELD_KEY && uketoriField ? (
                        <UketoriEditor
                          key={editingGroup}
                          field={uketoriField}
                          groupRows={groupRows}
                          onCancel={() => setEditingGroup(null)}
                          onSaved={async () => {
                            setEditingGroup(null);
                            setMessage({ type: "success", text: "Field saved successfully!" });
                            await loadFields();
                          }}
                        />
                      ) : editingGroup ? (
                        <GroupFieldEditor
                          key={editingGroup}
                          fieldKey={editingGroup}
                          groupRows={groupRows}
                          dailyFields={fields}
                          onCancel={() => setEditingGroup(null)}
                          onSaved={async () => {
                            setEditingGroup(null);
                            setMessage({ type: "success", text: "Field saved successfully!" });
                            await loadFields();
                          }}
                        />
                      ) : (
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
                            style={{ fontSize: 20 }}
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
                      )}
                    </Card.Body>
                  </Card>
                </Col>

                <Col md={5}>
                  <Card>
                    <Card.Header style={{ fontSize: 18 }}>
                      <List className="me-2" />
                      登録済みフィールド ({isDaily ? dailyEntries.length : fields.length})
                    </Card.Header>
                    <Card.Body className="p-0">
                      {loading ? (
                        <div className="text-center py-4">
                          <Spinner animation="border" />
                        </div>
                      ) : isDaily ? (
                        <div className="list-group list-group-flush scroll-panel">
                          {dailyEntries.map((e) => {
                            const key = e.kind === "field" ? e.field.field_key : e.field_key;
                            const label = e.kind === "field" ? uketoriLabel(groupRows) : e.field_label;
                            const options = e.kind === "field" ? uketoriOptions(e.field) : e.options;
                            return (
                              <div key={key} className="list-group-item">
                                <div className="d-flex justify-content-between align-items-start">
                                  <div className="flex-grow-1 me-2" style={{ minWidth: 0 }}>
                                    <h6 className="mb-1">{label}</h6>
                                    <div className="d-flex flex-wrap gap-1 mb-1">
                                      {options.map((o) => (
                                        <Badge key={o} bg="light" text="dark" className="border fw-normal">
                                          {o}
                                        </Badge>
                                      ))}
                                    </div>
                                    <small className="text-muted">
                                      {e.kind === "field"
                                        ? `単一選択 • ${options.length}選択肢`
                                        : `${e.multiple ? "複数選択可" : "単一選択"} • ${options.length}選択肢`}
                                    </small>
                                  </div>
                                  <div className="flex-shrink-0 d-flex">
                                    <Button
                                      variant="outline-primary"
                                      size="sm"
                                      onClick={() => {
                                        setMessage(null);
                                        setEditingGroup(e.kind === "field" ? e.field.field_key : e.field_key);
                                      }}
                                      aria-label={`${label}を編集`}
                                    >
                                      <Pencil />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : fields.length === 0 ? (
                        <div className="text-center py-4 text-muted">
                          フィールドがありません
                        </div>
                      ) : (
                        <div className="list-group list-group-flush scroll-panel">
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
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
