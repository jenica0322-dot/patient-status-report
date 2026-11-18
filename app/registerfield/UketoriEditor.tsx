// app/registerfield/UketoriEditor.tsx
// マスター editor for うけとり: its label (the heading on Status Input, e.g.
// うけとり状況を選択) and its options (玄関 / 家族 / 不在 …).
// The label lives in the daily_target うけとり row; the options stay in the
// daily_status うけとり row's phrases, whose field_label is left as is since
// it's the 報告書 column header.
"use client";

import React, { useState } from "react";
import { Card, Form, Button, InputGroup, Badge, Alert, Spinner } from "react-bootstrap";
import { Plus, Check, List } from "react-bootstrap-icons";
import { saveStatusField } from "@/app/lib/statusApi";
import {
  TARGET_GROUP_SCREEN_KEY,
  UKETORI_FIELD_KEY,
  uketoriLabel,
  uketoriOptions,
} from "@/app/lib/targetFields";

type Row = { screen_key: string; field_key: string; field_label: string; field_type: string; phrases: any; order_index: number };

type Props = {
  field: Row; // the daily_status うけとり row
  groupRows: Row[];
  onSaved: () => void;
  onCancel: () => void;
};

export default function UketoriEditor({ field, groupRows, onSaved, onCancel }: Props) {
  const [label, setLabel] = useState(() => uketoriLabel(groupRows));
  const [options, setOptions] = useState<string[]>(() => [...uketoriOptions(field)]);
  const [newOption, setNewOption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const add = () => {
    const text = newOption.trim();
    if (!text) return;
    if (options.includes(text)) {
      setError(`選択肢「${text}」はすでに登録されています`);
      return;
    }
    setError("");
    setOptions((prev) => [...prev, text]);
    setNewOption("");
  };

  const handleSave = async () => {
    if (!label.trim()) return setError("ラベルを入力してください");
    if (!options.length) return setError("選択肢を1つ以上登録してください");
    setError("");
    setSaving(true);
    try {
      const existing = groupRows.find((r) => r.field_key === UKETORI_FIELD_KEY);
      await saveStatusField({
        screen_key: TARGET_GROUP_SCREEN_KEY,
        field_key: UKETORI_FIELD_KEY,
        field_label: label.trim(),
        field_type: "heading",
        phrases: [],
        order_index: existing?.order_index ?? 0,
      });
      // Only the options change on the daily_status row.
      await saveStatusField({ ...field, phrases: options });
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
        <Form.Control value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: うけとり状況を選択" />
        <Form.Text muted>単一選択・選んだ名前が「{field.field_label}」列に保存されます</Form.Text>
      </Form.Group>

      <Card className="mb-3" style={{ background: "var(--secondary-bg)" }}>
        <Card.Header>
          <List className="me-2" />
          選択肢管理
        </Card.Header>
        <Card.Body>
          {options.length > 0 && (
            <div className="d-flex flex-wrap gap-2 mb-3">
              {options.map((p) => (
                <Badge key={p} bg="primary" className="d-flex align-items-center gap-1 py-2 px-3" style={{ fontWeight: 500 }}>
                  {p}
                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    style={{ fontSize: "0.55rem" }}
                    aria-label="削除"
                    onClick={() => setOptions((prev) => prev.filter((x) => x !== p))}
                  />
                </Badge>
              ))}
            </div>
          )}
          <InputGroup>
            <Form.Control
              placeholder="新しい選択肢を追加"
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button variant="outline-primary" onClick={add} aria-label="追加">
              <Plus />
            </Button>
          </InputGroup>
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
