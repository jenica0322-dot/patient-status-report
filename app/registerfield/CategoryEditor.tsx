// app/registerfield/CategoryEditor.tsx
// The one マスター editor for every 日次記録 category — うけとり, 食べ残し,
// 体調 and categories added here — and for adding a new one. Same features
// everywhere: label, 単一/複数選択, options (rename, reorder, delete) each
// with optional follow-up choices (追加選択肢, e.g. 体調他 → 風邪).
//
// Where answers are saved differs (see app/lib/targetFields.ts):
//   - 食べ残し / 体調 ("group"): each option picks its own 報告書 column.
//   - うけとり / added categories ("own"): every option saves into the
//     category's one column; its 報告書 column name is editable here.
"use client";

import React, { useState } from "react";
import { Card, Form, Button, ButtonGroup, InputGroup, Badge, Alert, Spinner } from "react-bootstrap";
import { Plus, Trash, ArrowUp, ArrowDown, Check, List } from "react-bootstrap-icons";
import { saveStatusField, deleteStatusField } from "@/app/lib/statusApi";
import {
  GROUP_MULTI_FIELD_TYPE,
  GROUP_SINGLE_FIELD_TYPE,
  HEADING_FIELD_TYPE,
  HEADING_MULTI_FIELD_TYPE,
  TARGET_GROUP_DEFS,
  TARGET_GROUP_SCREEN_KEY,
  UKETORI_FIELD_KEY,
  allCategoryConfigs,
  groupConfig,
  ownConfig,
  type CategoryOption,
} from "@/app/lib/targetFields";
import { addOptions, isAddEnter, splitOptions } from "./optionInput";

type Row = { screen_key: string; field_key: string; field_label: string; field_type: string; phrases: any; order_index: number };

export type CategoryEditorTarget =
  | { kind: "group"; fieldKey: string }
  | { kind: "own"; field: Row }
  | { kind: "new" };

// Report columns a 食べ残し / 体調 option can't save into.
const EXCLUDED_COLUMNS = new Set([UKETORI_FIELD_KEY, "youbi", "memo"]);
const PATIENT_SELECT_FIELD_LABEL = "利用者選択";

// A 日次記録 field key: any characters (Japanese included) except spaces and
// / ? # % \, and not starting with "__". Matches the server's check.
const VALID_FIELD_KEY = /^(?!__)[^\s/?#%\\]+$/;

type Props = {
  target: CategoryEditorTarget;
  groupRows: Row[];
  dailyFields: Row[];
  onSaved: () => void;
  onDeleted?: () => void;
  onCancel?: () => void;
  // 表示順: this category's place (0-based) among `total`; changing it calls
  // onMove, which saves the new order straight away.
  position?: number;
  total?: number;
  onMove?: (toIndex: number) => void;
};

// The values a category's column can hold — options, or their follow-ups.
function leafNames(options: CategoryOption[]): string[] {
  return options.flatMap((o) => (o.sub?.length ? o.sub : [o.label]));
}

export default function CategoryEditor({
  target,
  groupRows,
  dailyFields,
  onSaved,
  onDeleted,
  onCancel,
  position,
  total,
  onMove,
}: Props) {
  const isGroup = target.kind === "group";
  const isNew = target.kind === "new";
  const initial =
    target.kind === "group"
      ? groupConfig(target.fieldKey, groupRows, dailyFields)
      : target.kind === "own"
        ? ownConfig(target.field, groupRows)
        : null;

  const [label, setLabel] = useState(initial?.label ?? "");
  const [multiple, setMultiple] = useState(initial?.multiple ?? false);
  const [options, setOptions] = useState<CategoryOption[]>(() =>
    (initial?.options ?? []).map((o) => ({ ...o, sub: o.sub ? [...o.sub] : undefined }))
  );
  // 報告書 column name ("own" / new only).
  const [reportName, setReportName] = useState(target.kind === "own" ? target.field.field_label : "");
  const [fieldKey, setFieldKey] = useState("");
  const [newOption, setNewOption] = useState("");
  const [newSub, setNewSub] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const def = isGroup ? TARGET_GROUP_DEFS.find((d) => d.field_key === target.fieldKey) : undefined;
  const columns = dailyFields.filter(
    (f) => !EXCLUDED_COLUMNS.has(f.field_key) && f.field_label !== PATIENT_SELECT_FIELD_LABEL
  );
  const typeOf = (key?: string) => dailyFields.find((f) => f.field_key === key)?.field_type;
  // Follow-up choices are saved as text: always fine for an "own" category,
  // only on a text column for 食べ残し / 体調.
  const canHaveSub = (o: CategoryOption) => !isGroup || (!!o.key && typeOf(o.key) !== "checkbox");

  const update = (i: number, patch: Partial<CategoryOption>) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  const move = (i: number, dir: -1 | 1) =>
    setOptions((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const remove = (i: number) => {
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
    setNewSub({});
  };

  // Several at once (「新聞、郵便、回覧板」); duplicates are skipped.
  const addOptionRows = () => {
    const names = splitOptions(newOption);
    if (!names.length) return;
    const existing = new Set(options.map((o) => o.label));
    const used = new Set(options.map((o) => o.key).filter(Boolean));
    const added: CategoryOption[] = [];
    const duplicates: string[] = [];
    for (const n of names) {
      if (existing.has(n)) {
        duplicates.push(n);
        continue;
      }
      existing.add(n);
      if (isGroup) {
        // Pre-pick a column no other option uses (it can be changed).
        const free = columns.find((c) => !used.has(c.field_key));
        if (free) used.add(free.field_key);
        added.push({ label: n, key: free?.field_key ?? "" });
      } else {
        added.push({ label: n });
      }
    }
    setOptions((prev) => [...prev, ...added]);
    setNewOption("");
    setError(duplicates.length ? `「${duplicates.join("」「")}」はすでに登録されています` : "");
  };

  const addSub = (i: number) => {
    const current = options[i].sub ?? [];
    const { next, duplicates } = addOptions(current, newSub[i] || "");
    if (next.length !== current.length) update(i, { sub: next });
    setNewSub((m) => ({ ...m, [i]: "" }));
    setError(duplicates.length ? `「${duplicates.join("」「")}」はすでに登録されています` : "");
  };

  const removeSub = (i: number, s: string) => {
    const rest = (options[i].sub ?? []).filter((x) => x !== s);
    update(i, { sub: rest.length ? rest : undefined });
  };

  const validate = (): string | null => {
    if (!label.trim()) return "ラベルを入力してください";
    if (isNew) {
      const key = fieldKey.trim();
      if (key) {
        if (!VALID_FIELD_KEY.test(key)) return "フィールドキーにスペースや / ? # % \\ は使えません（空欄で自動設定）";
        if (dailyFields.some((f) => f.field_key === key) || groupRows.some((r) => r.field_key === key))
          return `フィールドキー「${key}」はすでに使われています`;
      }
    }
    if (!options.length) return "選択肢を1つ以上登録してください";
    const names = new Set<string>();
    const keys = new Set<string>();
    for (const o of options) {
      const l = o.label.trim();
      if (!l) return "選択肢名が空欄です";
      if (names.has(l)) return `選択肢「${l}」が重複しています`;
      names.add(l);
      if (isGroup) {
        if (!o.key) return `「${l}」の保存先の列を選択してください`;
        if (keys.has(o.key)) return `保存先の列が重複しています（「${l}」）`;
        keys.add(o.key);
      }
      if (o.sub?.length && !canHaveSub(o)) return `「${l}」の追加選択肢はテキスト列にのみ設定できます`;
      for (const s of o.sub ?? []) {
        if (names.has(s)) return `選択肢「${s}」が重複しています`;
        names.add(s);
      }
    }
    return null;
  };

  const cleanOptions = (): CategoryOption[] =>
    options.map((o) => ({
      label: o.label.trim(),
      ...(isGroup ? { key: o.key } : {}),
      ...(o.sub?.length ? { sub: o.sub } : {}),
    }));

  const handleSave = async () => {
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setSaving(true);
    try {
      const opts = cleanOptions();
      if (target.kind === "group") {
        const existing = groupRows.find((r) => r.field_key === target.fieldKey);
        await saveStatusField({
          screen_key: TARGET_GROUP_SCREEN_KEY,
          field_key: target.fieldKey,
          field_label: label.trim(),
          field_type: multiple ? GROUP_MULTI_FIELD_TYPE : GROUP_SINGLE_FIELD_TYPE,
          phrases: opts,
          order_index: existing?.order_index ?? initial!.order,
        });
      } else {
        // The category's own column (報告書 column + where answers are saved)…
        const base =
          target.kind === "own"
            ? target.field
            : {
                screen_key: "daily_status",
                field_key: fieldKey.trim() || `field_${Date.now().toString(36)}`,
                field_type: "preset",
                // New categories go after the existing ones.
                order_index: Math.max(0, ...dailyFields.map((f) => f.order_index || 0)) + 1,
              };
        await saveStatusField({
          ...base,
          field_label: reportName.trim() || label.trim(),
          phrases: leafNames(opts),
        });
        // …and its Status Input config (label, 単一/複数, options, 表示順 —
        // kept as is; a new category goes last).
        const existingRow = groupRows.find((r) => r.field_key === base.field_key);
        const displayOrder =
          existingRow?.order_index ??
          (target.kind === "own"
            ? initial!.order
            : Math.max(0, ...allCategoryConfigs(dailyFields, groupRows).map((c) => c.order)) + 1);
        await saveStatusField({
          screen_key: TARGET_GROUP_SCREEN_KEY,
          field_key: base.field_key,
          field_label: label.trim(),
          field_type: multiple ? HEADING_MULTI_FIELD_TYPE : HEADING_FIELD_TYPE,
          phrases: opts,
          order_index: displayOrder,
        });
      }
      if (isNew) {
        setLabel("");
        setMultiple(false);
        setOptions([]);
        setReportName("");
        setFieldKey("");
        setNewSub({});
      }
      onSaved();
    } catch (e) {
      console.error(e);
      setError(`保存に失敗しました${e instanceof Error && e.message !== "failed to save field" ? `（${e.message}）` : ""}`);
    } finally {
      setSaving(false);
    }
  };

  // Only categories added here can be deleted (うけとり / 食べ残し / 体調 are built in).
  const deletable = target.kind === "own" && target.field.field_key !== UKETORI_FIELD_KEY;
  const handleDelete = async () => {
    if (target.kind !== "own") return;
    if (!confirm(`「${label || target.field.field_label}」を削除しますか？\n状況入力と報告書から表示されなくなります（保存済みの記録データは残ります）。`))
      return;
    setSaving(true);
    try {
      await deleteStatusField(TARGET_GROUP_SCREEN_KEY, target.field.field_key);
      await deleteStatusField(target.field.screen_key, target.field.field_key);
      onDeleted?.();
    } catch (e) {
      console.error(e);
      setError("削除に失敗しました");
      setSaving(false);
    }
  };

  const enterAdds = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (isAddEnter(e)) {
      e.preventDefault();
      fn();
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
        <Form.Text muted>状況入力で選択肢の上に表示されます</Form.Text>
      </Form.Group>

      {!isNew && onMove && total !== undefined && position !== undefined && (
        <Form.Group className="mb-3">
          <Form.Label>表示順</Form.Label>
          <Form.Select
            value={position}
            onChange={(e) => onMove(Number(e.target.value))}
            disabled={saving}
            style={{ maxWidth: 200 }}
          >
            {Array.from({ length: total }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}番目
              </option>
            ))}
          </Form.Select>
          <Form.Text muted>状況入力で表示・音声で質問する順番です（報告書の列の順番は変わりません）</Form.Text>
        </Form.Group>
      )}

      <Form.Group className="mb-3">
        <Form.Label>選択方式</Form.Label>
        <div>
          <ButtonGroup>
            <Button variant={!multiple ? "primary" : "outline-primary"} onClick={() => setMultiple(false)} aria-pressed={!multiple}>
              単一選択
            </Button>
            <Button variant={multiple ? "primary" : "outline-primary"} onClick={() => setMultiple(true)} aria-pressed={multiple}>
              複数選択
            </Button>
          </ButtonGroup>
        </div>
        <Form.Text muted>
          {multiple ? "いくつでも選べます（音声は「次へ」で次の項目へ）" : "1つ選ぶと次の項目へ進みます"}
        </Form.Text>
      </Form.Group>

      {!isGroup && (
        <Form.Group className="mb-3">
          <Form.Label>報告書の列名</Form.Label>
          <Form.Control
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            placeholder={isNew ? "空欄ならラベルと同じ" : ""}
          />
          <Form.Text muted>選んだ名前がこの列に保存されます</Form.Text>
        </Form.Group>
      )}
      {isGroup && def && (
        <Form.Text muted className="d-block mb-3">
          各選択肢は報告書の列に保存されます・コメントは「
          {dailyFields.find((f) => f.field_key === def.anchorKey)?.field_label ?? def.anchorKey}」列に保存されます
        </Form.Text>
      )}

      {isNew && (
        <Form.Group className="mb-3">
          <Form.Label>フィールドキー（任意）</Form.Label>
          <Form.Control value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} placeholder="空欄で自動設定（日本語も可）" />
        </Form.Group>
      )}

      <Card className="mb-3" style={{ background: "var(--secondary-bg)" }}>
        <Card.Header>
          <List className="me-2" />
          選択肢管理{options.length > 0 && <span key="count" className="text-muted small ms-2">{options.length}件</span>}
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-2">
          {options.map((o, i) => (
            <div key={i} className="border rounded-3 p-2" style={{ background: "var(--primary-bg)" }}>
              <div className="d-flex flex-wrap gap-2 align-items-center">
                <Form.Control
                  style={{ flex: "1 1 140px", minWidth: 0 }}
                  value={o.label}
                  placeholder="選択肢名"
                  onChange={(e) => update(i, { label: e.target.value })}
                  aria-label="選択肢名"
                />
                {isGroup && (
                  <Form.Select
                    style={{ flex: "1 1 160px", minWidth: 0 }}
                    value={o.key ?? ""}
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
                )}
                <div className="d-flex gap-1">
                  <Button variant="outline-secondary" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">
                    <ArrowUp />
                  </Button>
                  <Button variant="outline-secondary" size="sm" onClick={() => move(i, 1)} disabled={i === options.length - 1} aria-label="下へ">
                    <ArrowDown />
                  </Button>
                  <Button variant="outline-danger" size="sm" onClick={() => remove(i)} aria-label="削除">
                    <Trash />
                  </Button>
                </div>
              </div>

              {canHaveSub(o) && (
                <div className="mt-2 ps-2">
                  <div className="small text-muted mb-1">追加選択肢（任意・選んだ名前が保存されます）</div>
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
                      placeholder="追加選択肢（「、」区切りで複数可）"
                      value={newSub[i] || ""}
                      onChange={(e) => setNewSub((m) => ({ ...m, [i]: e.target.value }))}
                      onKeyDown={enterAdds(() => addSub(i))}
                    />
                    <Button variant="outline-primary" onClick={() => addSub(i)} aria-label="追加">
                      <Plus />
                    </Button>
                  </InputGroup>
                </div>
              )}
            </div>
          ))}

          <InputGroup>
            <Form.Control
              placeholder="選択肢を追加（「、」区切りで複数可）"
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              onKeyDown={enterAdds(addOptionRows)}
            />
            <Button variant="outline-primary" onClick={addOptionRows} aria-label="選択肢を追加">
              <Plus />
            </Button>
          </InputGroup>
        </Card.Body>
      </Card>

      <div className="d-flex gap-2">
        {deletable && (
          <Button variant="outline-danger" size="lg" onClick={handleDelete} disabled={saving} aria-label="削除" style={{ fontSize: 18 }}>
            <Trash />
          </Button>
        )}
        {onCancel && (
          <Button variant="outline-secondary" size="lg" onClick={onCancel} disabled={saving} style={{ fontSize: 18 }}>
            キャンセル
          </Button>
        )}
        <Button variant="primary" size="lg" className="flex-grow-1" onClick={handleSave} disabled={saving} style={{ fontSize: 20 }}>
          {saving ? (
            <span key="saving">
              <Spinner animation="border" size="sm" className="me-2" />
              保存中...
            </span>
          ) : (
            <span key="idle">
              <Check className="me-2" />
              {isNew ? "追加" : "保存"}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
