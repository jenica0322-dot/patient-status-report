// app/registerfield/GroupFieldEditor.tsx
// マスター editor for a Status Input picker category (食べ残し / 体調): its
// label and its options. Each option saves into a 報告書 column (a
// daily_status field); an option on a text column can carry follow-up choices
// (e.g. 体調他 → 風邪) whose label is what gets saved.
"use client";

import React, { useState } from "react";
import { Card, Form, Button, InputGroup, Badge, Alert, Spinner } from "react-bootstrap";
import { Plus, Trash, ArrowUp, ArrowDown, Check, List } from "react-bootstrap-icons";
import { saveStatusField } from "@/app/lib/statusApi";
import {
  TARGET_GROUP_DEFS,
  TARGET_GROUP_SCREEN_KEY,
  UKETORI_FIELD_KEY,
  storedGroupLabel,
  storedGroupOptions,
  type StoredGroupOption,
} from "@/app/lib/targetFields";

type Row = { field_key: string; field_label: string; field_type: string; phrases: any; order_index: number };

// Report columns an option can't save into: うけとり has its own category,
// and 曜 / メモ / 利用者選択 aren't 食べ残し・体調 answers.
const EXCLUDED_COLUMNS = new Set([UKETORI_FIELD_KEY, "youbi", "memo"]);
const PATIENT_SELECT_FIELD_LABEL = "利用者選択";

type Props = {
  fieldKey: string;
  groupRows: Row[];
  dailyFields: Row[];
  onSaved: () => void;
  onCancel: () => void;
};

export default function GroupFieldEditor({ fieldKey, groupRows, dailyFields, onSaved, onCancel }: Props) {
  const def = TARGET_GROUP_DEFS.find((d) => d.field_key === fieldKey)!;
  const [label, setLabel] = useState(() => storedGroupLabel(fieldKey, groupRows));
  const [options, setOptions] = useState<StoredGroupOption[]>(() =>
    storedGroupOptions(fieldKey, groupRows).map((o) => ({ ...o, sub: o.sub ? [...o.sub] : undefined }))
  );
  const [newSub, setNewSub] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const columns = dailyFields.filter(
    (f) => !EXCLUDED_COLUMNS.has(f.field_key) && f.field_label !== PATIENT_SELECT_FIELD_LABEL
  );
  const typeOf = (key: string) => dailyFields.find((f) => f.field_key === key)?.field_type;

  const update = (i: number, patch: Partial<StoredGroupOption>) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  const move = (i: number, dir: -1 | 1) =>
    setOptions((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const remove = (i: number) => setOptions((prev) => prev.filter((_, idx) => idx !== i));

  const add = () => {
    const used = new Set(options.map((o) => o.key));
    const free = columns.find((c) => !used.has(c.field_key));
    setOptions((prev) => [...prev, { label: "", key: free?.field_key ?? "" }]);
  };

  const addSub = (i: number) => {
    const text = (newSub[i] || "").trim();
    if (!text) return;
    const current = options[i].sub ?? [];
    if (current.includes(text)) return;
    update(i, { sub: [...current, text] });
    setNewSub((m) => ({ ...m, [i]: "" }));
  };

  const removeSub = (i: number, s: string) => {
    const rest = (options[i].sub ?? []).filter((x) => x !== s);
    update(i, { sub: rest.length ? rest : undefined });
  };

  const validate = (): string | null => {
    if (!label.trim()) return "ラベルを入力してください";
    if (!options.length) return "選択肢を1つ以上登録してください";
    const labels = new Set<string>();
    const keys = new Set<string>();
    for (const o of options) {
      const l = o.label.trim();
      if (!l) return "選択肢名が空欄です";
      if (labels.has(l)) return `選択肢「${l}」が重複しています`;
      labels.add(l);
      if (!o.key) return `「${l}」の保存先の列を選択してください`;
      if (keys.has(o.key)) return `保存先の列が重複しています（「${l}」）`;
      keys.add(o.key);
      if (o.sub?.length && typeOf(o.key) === "checkbox")
        return `「${l}」の追加選択肢はテキスト列にのみ設定できます`;
      for (const s of o.sub ?? []) {
        if (labels.has(s)) return `選択肢「${s}」が重複しています`;
        labels.add(s);
      }
    }
    return null;
  };

  const handleSave = async () => {
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setSaving(true);
    try {
      const existing = groupRows.find((r) => r.field_key === fieldKey);
      await saveStatusField({
        screen_key: TARGET_GROUP_SCREEN_KEY,
        field_key: fieldKey,
        field_label: label.trim(),
        field_type: "group",
        phrases: options.map((o) => ({
          label: o.label.trim(),
          key: o.key,
          ...(o.sub?.length ? { sub: o.sub } : {}),
        })),
        order_index: existing?.order_index ?? TARGET_GROUP_DEFS.indexOf(def) + 1,
      });
      onSaved();
    } catch (e) {
      console.error(e);
      setError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Form.Group className="mb-3">
        <Form.Label>ラベル</Form.Label>
        <Form.Control value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: 食べ残し" />
        <Form.Text muted>
          {def.multiple ? "複数選択可" : "単一選択"}・コメントは「
          {dailyFields.find((f) => f.field_key === def.anchorKey)?.field_label ?? def.anchorKey}」列に保存されます
        </Form.Text>
      </Form.Group>

      <Card className="mb-3" style={{ background: "var(--secondary-bg)" }}>
        <Card.Header>
          <List className="me-2" />
          選択肢管理
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-2">
          {options.map((o, i) => {
            const isText = !!o.key && typeOf(o.key) !== "checkbox";
            return (
              <div key={i} className="border rounded-3 p-2" style={{ background: "var(--primary-bg)" }}>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <Form.Control
                    style={{ flex: "1 1 140px", minWidth: 0 }}
                    value={o.label}
                    placeholder="選択肢名"
                    onChange={(e) => update(i, { label: e.target.value })}
                    aria-label="選択肢名"
                  />
                  <Form.Select
                    style={{ flex: "1 1 160px", minWidth: 0 }}
                    value={o.key}
                    onChange={(e) => {
                      const key = e.target.value;
                      // Follow-up choices only make sense on a text column.
                      update(i, typeOf(key) === "checkbox" ? { key, sub: undefined } : { key });
                    }}
                    aria-label="保存先の列"
                  >
                    <option value="">保存先の列…</option>
                    {columns.map((c) => (
                      <option key={c.field_key} value={c.field_key}>
                        {c.field_label}（{c.field_type === "checkbox" ? "チェック" : "テキスト"}）
                      </option>
                    ))}
                  </Form.Select>
                  <div className="d-flex gap-1">
                    <Button variant="outline-secondary" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => move(i, 1)}
                      disabled={i === options.length - 1}
                      aria-label="下へ"
                    >
                      <ArrowDown />
                    </Button>
                    <Button variant="outline-danger" size="sm" onClick={() => remove(i)} aria-label="削除">
                      <Trash />
                    </Button>
                  </div>
                </div>

                {isText && (
                  <div className="mt-2 ps-2">
                    <div className="small text-muted mb-1">追加選択肢（選んだ名前がこの列に保存されます）</div>
                    {!!o.sub?.length && (
                      <div className="d-flex flex-wrap gap-2 mb-2">
                        {o.sub.map((s) => (
                          <Badge key={s} bg="primary" className="d-flex align-items-center gap-1 py-2 px-3" style={{ fontWeight: 500 }}>
                            {s}
                            <button
                              type="button"
                              className="btn-close btn-close-white"
                              style={{ fontSize: "0.55rem" }}
                              aria-label="削除"
                              onClick={() => removeSub(i, s)}
                            />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <InputGroup size="sm">
                      <Form.Control
                        placeholder="追加選択肢を入力"
                        value={newSub[i] || ""}
                        onChange={(e) => setNewSub((m) => ({ ...m, [i]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addSub(i);
                          }
                        }}
                      />
                      <Button variant="outline-primary" onClick={() => addSub(i)} aria-label="追加">
                        <Plus />
                      </Button>
                    </InputGroup>
                  </div>
                )}
              </div>
            );
          })}

          <Button variant="outline-primary" onClick={add} className="align-self-start">
            <Plus className="me-1" />
            選択肢を追加
          </Button>
        </Card.Body>
      </Card>

      <div className="d-flex gap-2">
        <Button variant="outline-secondary" size="lg" onClick={onCancel} disabled={saving} style={{ fontSize: 18 }}>
          キャンセル
        </Button>
        <Button variant="primary" size="lg" className="flex-grow-1" onClick={handleSave} disabled={saving} style={{ fontSize: 20 }}>
          {saving ? (
            <span key="saving">
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
    </div>
  );
}
