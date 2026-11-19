// app/registerfield/CategoryEditor.tsx
// The one マスター editor for every 日次記録 category — built-in or added —
// and for adding a new one. Every category gets the same settings, each set
// independently (see app/lib/targetFields.ts):
//   ラベル / 表示順 / 選択方式 (単一・複数) / 報告書の表示 (テキスト・チェック) /
//   報告書の列名 / 選択肢 (add, rename, delete, reorder, 追加選択肢) /
//   コメント入力 (あり・なし).
"use client";

import React, { useState } from "react";
import { Card, Form, Button, ButtonGroup, InputGroup, Badge, Alert, Spinner } from "react-bootstrap";
import { Plus, Trash, ArrowUp, ArrowDown, Check, List } from "react-bootstrap-icons";
import { saveStatusField, deleteStatusField } from "@/app/lib/statusApi";
import {
  TARGET_GROUP_SCREEN_KEY,
  allCategoryConfigs,
  categoryRow,
  categoryTextColumns,
  type CategoryConfig,
  type CategoryOption,
  type ReportDisplay,
} from "@/app/lib/targetFields";
import { addOptions, isAddEnter, splitOptions } from "./optionInput";

type Row = {
  screen_key: string;
  field_key: string;
  field_label: string;
  field_type: string;
  phrases: any;
  order_index: number;
  config?: any;
};

export type CategoryEditorTarget = { kind: "edit"; config: CategoryConfig } | { kind: "new" };

// Column-select value: create a new checkbox 報告書 column for this option
// (named after it) when saving.
const NEW_COLUMN = "__new_column__";

// Columns an option can never tick.
const EXCLUDED_COLUMNS = new Set(["youbi", "memo"]);
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

// The values a text column can hold — options, or their follow-ups.
function leafNames(options: CategoryOption[]): string[] {
  return options.flatMap((o) => (o.sub?.length ? o.sub : [o.label]));
}

const uid = () => Date.now().toString(36);

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
  const isNew = target.kind === "new";
  const initial = target.kind === "edit" ? target.config : undefined;
  const colLabel = (key?: string) => dailyFields.find((f) => f.field_key === key)?.field_label ?? "";

  const [label, setLabel] = useState(initial?.label ?? "");
  const [multiple, setMultiple] = useState(initial?.multiple ?? false);
  const [display, setDisplay] = useState<ReportDisplay>(initial?.display ?? "text");
  const [comment, setComment] = useState(initial?.comment ?? true);
  const [options, setOptions] = useState<CategoryOption[]>(() =>
    (initial?.options ?? []).map((o) => ({ ...o, sub: o.sub ? [...o.sub] : undefined }))
  );
  // 報告書の列名 of the text column (text display).
  const [reportName, setReportName] = useState(initial?.display === "text" ? colLabel(initial.column) : "");
  // 列名 edits for the checkbox columns options tick (checkbox display).
  const [colNames, setColNames] = useState<Record<string, string>>({});
  const [fieldKey, setFieldKey] = useState("");
  const [newOption, setNewOption] = useState("");
  const [newSub, setNewSub] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Columns an option can tick: 報告書 columns, but not a category's text
  // answer column (うけとり, …).
  const textColumns = categoryTextColumns(dailyFields, groupRows);
  const columns = dailyFields.filter(
    (f) => !EXCLUDED_COLUMNS.has(f.field_key) && f.field_label !== PATIENT_SELECT_FIELD_LABEL && !textColumns.has(f.field_key)
  );
  const typeOf = (key?: string) => (key === NEW_COLUMN ? "checkbox" : dailyFields.find((f) => f.field_key === key)?.field_type);
  // Follow-up choices are saved as a name: fine with text display, and with
  // checkbox display only on an option ticking a text column.
  const canHaveSub = (o: CategoryOption) => display === "text" || (!!o.key && typeOf(o.key) !== "checkbox");

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

  const switchDisplay = (d: ReportDisplay) => {
    setDisplay(d);
    if (d === "checkbox") {
      // Options without a column get a new checkbox column by default.
      setOptions((prev) => prev.map((o) => (o.key ? o : { ...o, key: NEW_COLUMN, sub: undefined })));
    }
  };

  // Several at once (「新聞、郵便、回覧板」); duplicates are skipped.
  const addOptionRows = () => {
    const names = splitOptions(newOption);
    if (!names.length) return;
    const existing = new Set(options.map((o) => o.label));
    const added: CategoryOption[] = [];
    const duplicates: string[] = [];
    for (const n of names) {
      if (existing.has(n)) {
        duplicates.push(n);
        continue;
      }
      existing.add(n);
      added.push(display === "checkbox" ? { label: n, key: NEW_COLUMN } : { label: n });
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
    if (isNew && display === "text") {
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
      if (display === "checkbox") {
        if (!o.key) return `「${l}」の保存先の列を選択してください`;
        if (o.key !== NEW_COLUMN && keys.has(o.key)) return `保存先の列が重複しています（「${l}」）`;
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

  const handleSave = async () => {
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setSaving(true);
    try {
      const opts: CategoryOption[] = options.map((o) => ({
        label: o.label.trim(),
        ...(display === "checkbox" && o.key ? { key: o.key } : {}),
        ...(o.sub?.length && canHaveSub(o) ? { sub: o.sub } : {}),
      }));
      let nextColumnOrder = Math.max(0, ...dailyFields.map((f) => f.order_index || 0)) + 1;
      const catKey =
        initial?.field_key ?? (display === "text" ? fieldKey.trim() || `field_${uid()}` : `cat_${uid()}`);
      let column: string | undefined;

      if (display === "text") {
        // The one 報告書 column holding the answer: the category's existing
        // text column, or a new one (new category / switched from チェック).
        column =
          initial?.display === "text" && initial.column
            ? initial.column
            : isNew
              ? catKey
              : `txt_${uid()}`;
        const existingCol = dailyFields.find((f) => f.field_key === column);
        await saveStatusField({
          ...(existingCol ?? {
            screen_key: "daily_status",
            field_key: column,
            field_type: "preset",
            order_index: nextColumnOrder++,
          }),
          field_label: reportName.trim() || label.trim(),
          phrases: leafNames(opts),
          register_category: false,
        });
      } else {
        // 「＋ 新しいチェック列を作成」: a checkbox 報告書 column per such
        // option (named after it); 列名 edits rename existing columns.
        for (let i = 0; i < opts.length; i++) {
          const o = opts[i];
          if (o.key === NEW_COLUMN) {
            const key = `chk_${uid()}_${i}`;
            await saveStatusField({
              screen_key: "daily_status",
              field_key: key,
              field_label: o.label,
              field_type: "checkbox",
              phrases: [],
              order_index: nextColumnOrder++,
              register_category: false,
            });
            opts[i] = { ...o, key };
          }
        }
        for (const [key, name] of Object.entries(colNames)) {
          const col = dailyFields.find((f) => f.field_key === key);
          if (col && name.trim() && name.trim() !== col.field_label && opts.some((o) => o.key === key)) {
            await saveStatusField({ ...col, field_label: name.trim(), register_category: false });
          }
        }
      }

      // Where the comment is stored: kept if its column still exists, else
      // the answer column / first ticked column.
      const keepComment =
        initial?.commentKey && dailyFields.some((f) => f.field_key === initial.commentKey) ? initial.commentKey : undefined;
      const commentKey = keepComment ?? (display === "text" ? column : opts.find((o) => o.key)?.key);

      const existingRow = groupRows.find((r) => r.field_key === catKey);
      const order =
        existingRow?.order_index ??
        initial?.order ??
        Math.max(0, ...allCategoryConfigs(dailyFields, groupRows).map((c) => c.order)) + 1;
      await saveStatusField(
        categoryRow(
          { field_key: catKey, label: label.trim(), display, multiple, column, comment, commentKey, options: opts },
          order
        )
      );

      if (isNew) {
        setLabel("");
        setMultiple(false);
        setDisplay("text");
        setComment(true);
        setOptions([]);
        setReportName("");
        setColNames({});
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

  // Categories added in マスター can be deleted; built-in ones can't (their
  // defaults would just come back).
  const deletable = !!initial && !initial.builtin;
  const handleDelete = async () => {
    if (!initial) return;
    if (
      !confirm(
        `「${label || initial.label}」を削除しますか？\n状況入力に表示されなくなります（保存済みの記録データは残ります）。`
      )
    )
      return;
    setSaving(true);
    try {
      await deleteStatusField(TARGET_GROUP_SCREEN_KEY, initial.field_key);
      // A text category's own answer column (created with it) goes too.
      if (initial.display === "text" && initial.column === initial.field_key) {
        await deleteStatusField("daily_status", initial.column);
      }
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

  const toggle = (on: boolean, a: string, b: string, set: (v: boolean) => void) => (
    <ButtonGroup>
      <Button variant={on ? "primary" : "outline-primary"} onClick={() => set(true)} aria-pressed={on}>
        {a}
      </Button>
      <Button variant={!on ? "primary" : "outline-primary"} onClick={() => set(false)} aria-pressed={!on}>
        {b}
      </Button>
    </ButtonGroup>
  );

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
          <Form.Select value={position} onChange={(e) => onMove(Number(e.target.value))} disabled={saving} style={{ maxWidth: 200 }}>
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
        <div>{toggle(!multiple, "単一選択", "複数選択", (v) => setMultiple(!v))}</div>
        <Form.Text muted>
          {multiple ? "いくつでも選べます（音声は「次へ」で次の項目へ）" : "1つ選ぶと次の項目へ進みます"}
        </Form.Text>
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Label>報告書の表示</Form.Label>
        <div>{toggle(display === "text", "テキスト", "チェック", (v) => switchDisplay(v ? "text" : "checkbox"))}</div>
        <Form.Text muted>
          {display === "text"
            ? `1つの列に選んだ名前を記入します${multiple ? "（複数は「、」区切り）" : ""}`
            : "選択肢ごとの列にチェック（✓）を付けます"}
        </Form.Text>
      </Form.Group>

      {display === "text" && (
        <Form.Group className="mb-3">
          <Form.Label>報告書の列名</Form.Label>
          <Form.Control value={reportName} onChange={(e) => setReportName(e.target.value)} placeholder="空欄ならラベルと同じ" />
        </Form.Group>
      )}

      <Form.Group className="mb-3">
        <Form.Label>コメント入力</Form.Label>
        <div>{toggle(comment, "あり", "なし", setComment)}</div>
        <Form.Text muted>状況入力でこの項目にコメント欄を表示します</Form.Text>
      </Form.Group>

      {isNew && display === "text" && (
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
          {options.map((o, i) => {
            const existingCol = display === "checkbox" && o.key && o.key !== NEW_COLUMN ? o.key : undefined;
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
                  {display === "checkbox" && (
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
                      <option value={NEW_COLUMN}>＋ 新しいチェック列を作成（「{o.label.trim() || "選択肢名"}」）</option>
                    </Form.Select>
                  )}
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

                {existingCol && (
                  <InputGroup size="sm" className="mt-2">
                    <InputGroup.Text>報告書の列名</InputGroup.Text>
                    <Form.Control
                      value={colNames[existingCol] ?? colLabel(existingCol)}
                      onChange={(e) => setColNames((m) => ({ ...m, [existingCol]: e.target.value }))}
                    />
                  </InputGroup>
                )}

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
            );
          })}

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
