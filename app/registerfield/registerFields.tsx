// app/registerfield/registerFields.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import ReportLayoutSettings from "./ReportLayoutSettings";
import CategoryEditor, { type CategoryEditorTarget } from "./CategoryEditor";
import { addOptions, isAddEnter } from "./optionInput";
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
  ArrowUp,
  ArrowDown,
  Database,
  List,
} from "react-bootstrap-icons";
import {
  fetchStatusFields,
  saveStatusField,
  deleteStatusField,
} from "@/app/lib/statusApi";
import {
  TARGET_GROUP_SCREEN_KEY,
  HEADING_FIELD_TYPE,
  allCategoryConfigs,
  categoryRow,
  optionDisplayNames,
} from "@/app/lib/targetFields";

// 日次記録: the 登録済みフィールド list shows the categories Status Input asks
// (うけとり, 食べ残し, 体調 and any added here — allCategoryConfigs), and every
// one is edited, and new ones added, with the same CategoryEditor. The other
// daily status_fields rows stay in the DB as report columns but aren't listed.

// A 日次記録 field key: any characters (Japanese included) except spaces and
// / ? # % \, and not starting with "__". Matches the server's check.
const VALID_FIELD_KEY = /^(?!__)[^\s/?#%\\]+$/;

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
  // Category being edited (its field_key), or null → the editor adds a new one.
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const isDaily = form.screen_key === "daily_status";
  const dailyEntries = isDaily ? allCategoryConfigs(fields, groupRows) : [];
  const editingEntry = editingGroup ? dailyEntries.find((c) => c.field_key === editingGroup) : undefined;
  // Every category is edited the same way; no editing → the editor adds one.
  const editorTarget: CategoryEditorTarget = editingEntry ? { kind: "edit", config: editingEntry } : { kind: "new" };
  const editingLabel = editorTarget.kind === "new" ? "" : editingEntry?.label ?? "";
  const editingPosition = editingGroup ? dailyEntries.findIndex((c) => c.field_key === editingGroup) : -1;
  const [reordering, setReordering] = useState(false);

  // 表示順: moves a category to `to` (0-based) and saves every category's
  // position (its daily_target row's order_index = 1, 2, 3, …). Only Status
  // Input / this list follow it; the 報告書 column order is untouched.
  const moveCategory = async (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= dailyEntries.length) return;
    const ordered = [...dailyEntries];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    setReordering(true);
    setMessage(null);
    try {
      for (let i = 0; i < ordered.length; i++) {
        const c = ordered[i];
        // Same row as the editor saves, only the position changes.
        await saveStatusField(categoryRow(c, i + 1));
      }
      setMessage({ type: "success", text: `「${moved.label}」を${to + 1}番目にしました` });
      await loadFields();
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "表示順の保存に失敗しました" });
      await loadFields();
    } finally {
      setReordering(false);
    }
  };
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
    const isDailyAdd = form.screen_key === "daily_status";
    // On 日次記録 the key is optional — left blank, one is generated (it's only
    // an internal name; the ラベル is what's shown).
    const key = form.field_key.trim() || (isDailyAdd ? `field_${Date.now().toString(36)}` : "");
    if (!key) {
      setMessage({ type: "error", text: "フィールドキーを入力してください" });
      return;
    }
    if (isDailyAdd) {
      // On 日次記録 this form only adds new categories (existing ones are edited
      // from the list), so the key must be new — reusing one would overwrite a
      // 報告書 column or a built-in category. Japanese is fine; spaces and
      // / ? # % \ aren't (the key goes into URLs), nor a leading "__"
      // (reserved for 食べ残し / 体調).
      if (!VALID_FIELD_KEY.test(key)) {
        setMessage({
          type: "error",
          text: "フィールドキーにスペースや / ? # % \\ は使えません（空欄にすると自動で設定されます）",
        });
        return;
      }
      if (fields.some((f) => f.field_key === key) || groupRows.some((r) => r.field_key === key)) {
        setMessage({ type: "error", text: `フィールドキー「${key}」はすでに使われています` });
        return;
      }
      if (!form.field_label.trim()) {
        setMessage({ type: "error", text: "ラベルを入力してください" });
        return;
      }
      if (form.field_type === "preset" && !form.phrases.length) {
        setMessage({ type: "error", text: "プリセットの選択肢を1つ以上登録してください" });
        return;
      }
    }
    try {
      setLoading(true);
      setMessage(null);
      // A new 日次記録 field with no 表示順 goes after the existing ones.
      const order =
        isDailyAdd && !form.order_index
          ? Math.max(0, ...fields.map((f) => f.order_index || 0)) + 1
          : form.order_index;
      const saved = { ...form, field_key: key, field_label: form.field_label.trim(), order_index: order };
      await saveStatusField(saved);
      if (isDailyAdd) {
        // Registers it as a Status Input category (shown there and in this
        // list); its label is the heading shown above its input.
        await saveStatusField({
          screen_key: TARGET_GROUP_SCREEN_KEY,
          field_key: key,
          field_label: saved.field_label,
          field_type: HEADING_FIELD_TYPE,
          phrases: [],
          order_index: order,
        });
      }
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
      setMessage({
        type: "error",
        text: `保存に失敗しました${e instanceof Error && e.message !== "failed to save field" ? `（${e.message}）` : ""}`,
      });
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

  // Several can be added at once (「新聞、郵便、回覧板」); duplicates are skipped.
  const addPhrase = () => {
    const { next, duplicates } = addOptions(form.phrases, newPhrase);
    if (next.length !== form.phrases.length) setForm({ ...form, phrases: next });
    setNewPhrase("");
    if (duplicates.length) {
      setMessage({ type: "error", text: `「${duplicates.join("」「")}」はすでに登録されています` });
    }
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
          <h1 className="page-title mb-0">フィールド登録・管理</h1>
          <p className="page-subtitle mb-0">記録項目のマスターデータを管理します</p>
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
                  >
                    報告書レイアウト
                  </Button>
                </div>
              </Form.Group>

              {layoutTab ? (
                <ReportLayoutSettings onDirtyChange={(d) => (layoutDirtyRef.current = d)} />
              ) : (
              <Row>
                <Col lg={7}>
                  <Card className="mb-3 mb-lg-0">
                    <Card.Header>
                      <Database className="me-2" />
                      フィールド情報
                      {isDaily && (
                        <span key="editing-group">
                          （{editorTarget.kind === "new" ? "新規追加" : editingLabel}）
                        </span>
                      )}
                    </Card.Header>
                    <Card.Body>
                      {isDaily ? (
                        <CategoryEditor
                          key={editorTarget.kind === "new" ? "new" : editingGroup!}
                          target={editorTarget}
                          groupRows={groupRows}
                          dailyFields={fields}
                          onCancel={editorTarget.kind === "new" ? undefined : () => setEditingGroup(null)}
                          onSaved={async () => {
                            const added = editorTarget.kind === "new";
                            setEditingGroup(null);
                            setMessage({ type: "success", text: added ? "追加しました" : "保存しました" });
                            await loadFields();
                          }}
                          onDeleted={async () => {
                            setEditingGroup(null);
                            setMessage({ type: "success", text: "削除しました" });
                            await loadFields();
                          }}
                          position={editingPosition >= 0 ? editingPosition : undefined}
                          total={dailyEntries.length}
                          onMove={(to) => moveCategory(editingPosition, to)}
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
                                placeholder={
                                  isDaily ? "空欄で自動設定（日本語も可）" : "ユニークなキー (例: kanshoku)"
                                }
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
                                  <h6 className="form-label mb-2">登録済みフレーズ</h6>
                                  <div className="d-flex flex-wrap gap-2">
                                    {form.phrases.map((p, idx) => (
                                      <Badge
                                        key={p}
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
                                  placeholder="選択肢を追加（「、」区切りで複数可）"
                                  value={newPhrase}
                                  onChange={(e) => setNewPhrase(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (isAddEnter(e)) {
                                      e.preventDefault();
                                      addPhrase();
                                    }
                                  }}
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
                      )}
                    </Card.Body>
                  </Card>
                </Col>

                <Col lg={5}>
                  <Card>
                    <Card.Header>
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
                          {dailyEntries.map((e, idx) => {
                            const names = optionDisplayNames(e.options);
                            const active = e.field_key === editingGroup;
                            return (
                              <div key={e.field_key} className={`list-group-item ${active ? "active-entry" : ""}`}
                                style={active ? { background: "var(--brand-50)" } : undefined}>
                                <div className="d-flex justify-content-between align-items-start">
                                  <div className="flex-grow-1 me-2" style={{ minWidth: 0 }}>
                                    <h6 className="mb-1">
                                      <span className="text-muted me-1">{idx + 1}.</span>
                                      {e.label}
                                    </h6>
                                    <div className="d-flex flex-wrap gap-1 mb-1">
                                      {names.map((o) => (
                                        <Badge key={o} bg="light" text="dark" className="border fw-normal">
                                          {o}
                                        </Badge>
                                      ))}
                                    </div>
                                    <small className="text-muted">
                                      {`${e.multiple ? "複数選択" : "単一選択"} • ${e.display === "text" ? "テキスト" : "チェック"} • ${names.length}選択肢${e.comment ? "" : " • コメントなし"}`}
                                    </small>
                                  </div>
                                  <div className="flex-shrink-0 d-flex gap-1">
                                    <Button
                                      variant="outline-secondary"
                                      size="sm"
                                      onClick={() => moveCategory(idx, idx - 1)}
                                      disabled={reordering || idx === 0}
                                      aria-label={`${e.label}を上へ`}
                                    >
                                      <ArrowUp />
                                    </Button>
                                    <Button
                                      variant="outline-secondary"
                                      size="sm"
                                      onClick={() => moveCategory(idx, idx + 1)}
                                      disabled={reordering || idx === dailyEntries.length - 1}
                                      aria-label={`${e.label}を下へ`}
                                    >
                                      <ArrowDown />
                                    </Button>
                                    <Button
                                      variant="outline-primary"
                                      size="sm"
                                      onClick={() => {
                                        setMessage(null);
                                        setEditingGroup(e.field_key);
                                      }}
                                      aria-label={`${e.label}を編集`}
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
