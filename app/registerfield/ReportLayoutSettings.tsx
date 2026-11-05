// app/registerfield/ReportLayoutSettings.tsx
// マスター → 報告書レイアウト tab: lays out the 報告書's 報告書コメント欄 (①②… blocks) and footer row
// (報告日 / 確認者 / …). The report screen and the Excel / PDF exports all
// follow what is saved here (see server/lib/reportLayout.js).
"use client";

import { useEffect, useMemo, useState, Fragment, KeyboardEvent } from "react";
import { Card, Form, Button, Alert, Spinner, Badge, InputGroup, Row, Col } from "react-bootstrap";
import {
  Plus,
  Trash,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeSlash,
  Check,
  ArrowCounterclockwise,
} from "react-bootstrap-icons";
import {
  ReportLayout,
  CommentBlockConfig,
  FooterItemConfig,
  FooterItemType,
  FOOTER_TYPE_LABELS,
  MAX_PER_ROW,
  fetchReportLayout,
  saveReportLayout,
  resetReportLayout,
  newFieldKey,
  visibleCommentBlocks,
  planCommentRows,
  planFooterRows,
} from "@/app/lib/reportLayout";
import styles from "@/app/styles/MasterSettings.module.css";

// Rows the comment blocks sit beside on the real sheet (the 11 tally rows).
const PREVIEW_TALLY_ROWS = 11;
const PREVIEW_COLS = 19;

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---- 選択肢 editor: chips (reorder / remove) + an input to add ----
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    if (options.includes(text)) {
      setError(`「${text}」はすでにあります`);
      return;
    }
    onChange([...options, text]);
    setDraft("");
    setError(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      add();
    }
  };
  return (
    <div>
      {options.length > 0 ? (
        <div className={styles.chips}>
          {options.map((o, i) => (
            <span key={o} className={styles.chip}>
              <button
                type="button"
                className={styles.chipBtn}
                aria-label={`「${o}」を左へ`}
                disabled={i === 0}
                onClick={() => onChange(move(options, i, i - 1))}
              >
                <ArrowLeft size={11} />
              </button>
              <span className={styles.chipLabel}>☐{o}</span>
              <button
                type="button"
                className={styles.chipBtn}
                aria-label={`「${o}」を右へ`}
                disabled={i === options.length - 1}
                onClick={() => onChange(move(options, i, i + 1))}
              >
                <ArrowRight size={11} />
              </button>
              <button
                type="button"
                className={`${styles.chipBtn} ${styles.chipRemove}`}
                aria-label={`「${o}」を削除`}
                onClick={() => onChange(options.filter((x) => x !== o))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-muted small mb-1">選択肢がありません</div>
      )}
      <InputGroup size="sm" className="mt-1">
        <Form.Control
          placeholder="選択肢を追加（Enter）"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={onKey}
        />
        <Button variant="outline-primary" onClick={add} aria-label="選択肢を追加">
          <Plus />
        </Button>
      </InputGroup>
      {error && <div className="text-danger small mt-1">{error}</div>}
    </div>
  );
}

// ---- Shared row controls: ↑ ↓ 表示/非表示 削除 ----
function ItemControls({
  index,
  count,
  visible,
  onMove,
  onToggleVisible,
  onDelete,
}: {
  index: number;
  count: number;
  visible: boolean;
  onMove: (to: number) => void;
  onToggleVisible: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={styles.controls}>
      <Button size="sm" variant="outline-secondary" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label="上へ">
        <ArrowUp />
      </Button>
      <Button
        size="sm"
        variant="outline-secondary"
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        aria-label="下へ"
      >
        <ArrowDown />
      </Button>
      <Button
        size="sm"
        variant={visible ? "outline-success" : "outline-secondary"}
        onClick={onToggleVisible}
        aria-pressed={visible}
        title={visible ? "表示中（クリックで非表示）" : "非表示（クリックで表示）"}
      >
        {visible ? <Eye /> : <EyeSlash />}
        <span className="ms-1 d-none d-sm-inline">{visible ? "表示" : "非表示"}</span>
      </Button>
      <Button size="sm" variant="outline-danger" onClick={onDelete} aria-label="削除">
        <Trash />
      </Button>
    </div>
  );
}

// ---- Live preview of the two sections, laid out the way the report will be ----
function LayoutPreview({ layout }: { layout: ReportLayout }) {
  const blocks = visibleCommentBlocks(layout);
  const plan = planCommentRows(PREVIEW_TALLY_ROWS, blocks.length);
  const footerRows = planFooterRows(layout, PREVIEW_COLS);
  const starts = new Map<number, { block: (typeof blocks)[number]; span: number }>();
  let cursor = 0;
  blocks.forEach((b, i) => {
    starts.set(cursor, { block: b, span: plan.spans[i] });
    cursor += plan.spans[i];
  });
  const covered = new Set<number>();
  starts.forEach(({ span }, start) => {
    for (let k = 1; k < span; k++) covered.add(start + k);
  });

  return (
    <div className={styles.previewScroll}>
      <table className={styles.preview}>
        <colgroup>
          {Array.from({ length: PREVIEW_COLS }, (_, i) => (
            <col key={i} />
          ))}
        </colgroup>
        <tbody>
          <tr>
            <th colSpan={8} className={styles.previewHead}>
              分類／確認項目／件数
            </th>
            <th colSpan={PREVIEW_COLS - 8} className={styles.previewHead}>
              報告書コメント欄
            </th>
          </tr>
          {Array.from({ length: plan.totalRows }, (_, r) => {
            const start = starts.get(r);
            return (
              <tr key={r}>
                <td colSpan={8} className={styles.previewTally}>
                  {r < PREVIEW_TALLY_ROWS ? "　" : ""}
                </td>
                {covered.has(r) ? null : (
                  <td colSpan={PREVIEW_COLS - 8} rowSpan={start ? start.span : 1} className={styles.previewBlock}>
                    {start && (
                      <>
                        <div className="fw-bold">
                          {start.block.numeral}
                          {start.block.title || "（見出しなし）"}
                        </div>
                        <div>{start.block.options.map((o) => `☐${o}`).join("　") || "（選択肢なし）"}</div>
                        {start.block.freeText.enabled && <div>{start.block.freeText.label}：</div>}
                      </>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          <tr>
            <th colSpan={2} className={styles.previewHead}>
              総評
            </th>
            <td colSpan={PREVIEW_COLS - 2} className={styles.previewBlock}></td>
          </tr>
          {footerRows.map((cells, r) => (
            <tr key={`f${r}`}>
              {cells.map(({ item, labelSpan, valueSpan }) => (
                <Fragment key={item.fieldKey}>
                  <th colSpan={labelSpan} className={styles.previewHead}>
                    {item.label || "（項目名なし）"}
                  </th>
                  <td colSpan={valueSpan} className={styles.previewBlock}>
                    {item.type === "checklist"
                      ? item.options.map((o) => `☐${o}`).join("　")
                      : item.type === "date"
                      ? "📅 日付"
                      : ""}
                  </td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// `onDirtyChange` tells the マスター page whether there are unsaved edits, so
// switching tabs can ask before dropping them.
export default function ReportLayoutSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [layout, setLayout] = useState<ReportLayout | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "danger"; text: string } | null>(null);

  const applyLoaded = (res: { layout: ReportLayout; isDefault: boolean }) => {
    setLayout(res.layout);
    setSavedJson(JSON.stringify(res.layout));
    setIsDefault(res.isDefault);
  };

  useEffect(() => {
    fetchReportLayout()
      .then(applyLoaded)
      .catch((e) => setMessage({ type: "danger", text: `読み込みに失敗しました（${e.message}）` }))
      .finally(() => setLoading(false));
  }, []);

  const dirty = useMemo(() => !!layout && JSON.stringify(layout) !== savedJson, [layout, savedJson]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" />
      </div>
    );
  }
  if (!layout) {
    return message ? <Alert variant={message.type}>{message.text}</Alert> : null;
  }

  // ---- edits ----
  const setBlocks = (blocks: CommentBlockConfig[]) => setLayout({ ...layout, commentBlocks: blocks });
  const updateBlock = (i: number, patch: Partial<CommentBlockConfig>) =>
    setBlocks(layout.commentBlocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const addBlock = () => {
    const key = newFieldKey("rb");
    setBlocks([
      ...layout.commentBlocks,
      { fieldKey: key, title: "", options: [], visible: true, freeText: { enabled: true, fieldKey: `${key}_note`, label: "一言" } },
    ]);
  };
  const deleteBlock = (i: number) => {
    const b = layout.commentBlocks[i];
    if (!confirm(`「${b.title || "（見出しなし）"}」を削除しますか？\n（入力済みの記録は消えません。同じ項目は「非表示」でも隠せます）`)) return;
    setBlocks(layout.commentBlocks.filter((_, j) => j !== i));
  };

  const setItems = (items: FooterItemConfig[]) => setLayout({ ...layout, footer: { ...layout.footer, items } });
  const updateItem = (i: number, patch: Partial<FooterItemConfig>) =>
    setItems(layout.footer.items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addItem = () =>
    setItems([...layout.footer.items, { fieldKey: newFieldKey("rf"), label: "", type: "text", options: [], visible: true }]);
  const deleteItem = (i: number) => {
    const it = layout.footer.items[i];
    if (!confirm(`「${it.label || "（項目名なし）"}」を削除しますか？\n（入力済みの記録は消えません。同じ項目は「非表示」でも隠せます）`)) return;
    setItems(layout.footer.items.filter((_, j) => j !== i));
  };

  // ---- save / discard / reset ----
  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      applyLoaded(await saveReportLayout(layout));
      setMessage({ type: "success", text: "保存しました。報告書・Excel・PDF に反映されます。" });
    } catch (e: any) {
      setMessage({ type: "danger", text: `保存できませんでした：${e.message}` });
    } finally {
      setSaving(false);
    }
  };
  const handleDiscard = () => {
    if (!confirm("保存していない変更を取り消しますか？")) return;
    setLayout(JSON.parse(savedJson));
    setMessage(null);
  };
  const handleReset = async () => {
    if (!confirm("初期レイアウト（元の報告書の形）に戻しますか？\n入力済みの記録は消えません。")) return;
    setSaving(true);
    setMessage(null);
    try {
      applyLoaded(await resetReportLayout());
      setMessage({ type: "success", text: "初期レイアウトに戻しました。" });
    } catch (e: any) {
      setMessage({ type: "danger", text: `戻せませんでした：${e.message}` });
    } finally {
      setSaving(false);
    }
  };

  const numerals = visibleCommentBlocks(layout);
  const numeralOf = (b: CommentBlockConfig) => numerals.find((n) => n.fieldKey === b.fieldKey)?.numeral;

  return (
    <div>
      <p className="text-muted small mb-2">
        報告書の「報告書コメント欄」と「フッター」のレイアウトを設定します。報告書画面・Excel・PDF に反映されます。
      </p>

      {/* Sticky action bar */}
      <div className={styles.actionBar}>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {dirty ? (
            <Badge bg="warning" text="dark">
              未保存の変更があります
            </Badge>
          ) : isDefault ? (
            <Badge bg="secondary">初期レイアウト</Badge>
          ) : (
            <Badge bg="success">保存済み</Badge>
          )}
        </div>
        <div className="d-flex gap-2 flex-wrap ms-auto">
          <Button variant="outline-secondary" size="sm" onClick={handleReset} disabled={saving || isDefault}>
            <ArrowCounterclockwise className="me-1" />
            初期レイアウトに戻す
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={handleDiscard} disabled={saving || !dirty}>
            変更を取り消す
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? <Spinner animation="border" size="sm" className="me-1" /> : <Check className="me-1" />}
            保存
          </Button>
        </div>
      </div>

      {message && (
        <Alert variant={message.type} dismissible onClose={() => setMessage(null)} className="mt-2">
          {message.text}
        </Alert>
      )}

      <Row className="g-3 mt-1">
        <Col xl={7}>
          {/* ---- 報告書コメント欄 ---- */}
          <Card className="mb-3">
            <Card.Header className={styles.sectionHeader}>
              <span>報告書コメント欄（①②…）</span>
              <Button size="sm" variant="primary" onClick={addBlock}>
                <Plus className="me-1" />
                項目を追加
              </Button>
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              <p className="text-muted small mb-0">
                番号（①②…）は表示中の項目に上から順に付きます。選択肢は報告書で1つだけ✓できます。
                選択肢の名前を変えると、過去にその選択肢を✓した記録には✓が付かなくなります。
              </p>
              {layout.commentBlocks.length === 0 && <div className="text-muted">項目がありません</div>}
              {layout.commentBlocks.map((b, i) => (
                <div key={b.fieldKey} className={`${styles.itemCard} ${b.visible ? "" : styles.itemHidden}`}>
                  <div className={styles.itemHead}>
                    <span className={styles.numeral}>{numeralOf(b) ?? "－"}</span>
                    <Form.Control
                      className="fw-bold"
                      placeholder="見出し（例: 総合評価）"
                      value={b.title}
                      isInvalid={!b.title.trim()}
                      onChange={(e) => updateBlock(i, { title: e.target.value })}
                    />
                    <ItemControls
                      index={i}
                      count={layout.commentBlocks.length}
                      visible={b.visible}
                      onMove={(to) => setBlocks(move(layout.commentBlocks, i, to))}
                      onToggleVisible={() => updateBlock(i, { visible: !b.visible })}
                      onDelete={() => deleteBlock(i)}
                    />
                  </div>
                  <Form.Label className="small text-muted mb-1 mt-2">選択肢</Form.Label>
                  <OptionsEditor options={b.options} onChange={(options) => updateBlock(i, { options })} />
                  <div className={styles.freeTextRow}>
                    <Form.Check
                      type="switch"
                      id={`ft-${b.fieldKey}`}
                      label="自由記入欄"
                      checked={b.freeText.enabled}
                      onChange={(e) => updateBlock(i, { freeText: { ...b.freeText, enabled: e.target.checked } })}
                    />
                    {b.freeText.enabled && (
                      <InputGroup size="sm" className={styles.freeTextLabel}>
                        <InputGroup.Text>名前</InputGroup.Text>
                        <Form.Control
                          placeholder="一言 / 内容 / 方針 など"
                          value={b.freeText.label}
                          isInvalid={!b.freeText.label.trim()}
                          onChange={(e) => updateBlock(i, { freeText: { ...b.freeText, label: e.target.value } })}
                        />
                      </InputGroup>
                    )}
                  </div>
                  <div className={styles.keyNote}>キー: {b.fieldKey}</div>
                </div>
              ))}
            </Card.Body>
          </Card>

          {/* ---- フッター ---- */}
          <Card>
            <Card.Header className={styles.sectionHeader}>
              <span>フッター（報告日・確認者 など）</span>
              <Button size="sm" variant="primary" onClick={addItem}>
                <Plus className="me-1" />
                項目を追加
              </Button>
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              <InputGroup size="sm" style={{ maxWidth: 260 }}>
                <InputGroup.Text>1行あたりの項目数</InputGroup.Text>
                <Form.Select
                  value={layout.footer.perRow}
                  onChange={(e) => setLayout({ ...layout, footer: { ...layout.footer, perRow: Number(e.target.value) } })}
                >
                  {Array.from({ length: MAX_PER_ROW }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Form.Select>
              </InputGroup>
              {layout.footer.items.length === 0 && <div className="text-muted">項目がありません</div>}
              {layout.footer.items.map((it, i) => (
                <div key={it.fieldKey} className={`${styles.itemCard} ${it.visible ? "" : styles.itemHidden}`}>
                  <div className={styles.itemHead}>
                    <Form.Control
                      className="fw-bold"
                      placeholder="項目名（例: 確認者）"
                      value={it.label}
                      isInvalid={!it.label.trim()}
                      onChange={(e) => updateItem(i, { label: e.target.value })}
                    />
                    <Form.Select
                      className={styles.typeSelect}
                      value={it.type}
                      onChange={(e) => updateItem(i, { type: e.target.value as FooterItemType })}
                      aria-label="入力の種類"
                    >
                      {(Object.keys(FOOTER_TYPE_LABELS) as FooterItemType[]).map((t) => (
                        <option key={t} value={t}>
                          {FOOTER_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </Form.Select>
                    <ItemControls
                      index={i}
                      count={layout.footer.items.length}
                      visible={it.visible}
                      onMove={(to) => setItems(move(layout.footer.items, i, to))}
                      onToggleVisible={() => updateItem(i, { visible: !it.visible })}
                      onDelete={() => deleteItem(i)}
                    />
                  </div>
                  {it.type === "checklist" && (
                    <>
                      <Form.Label className="small text-muted mb-1 mt-2">選択肢</Form.Label>
                      <OptionsEditor options={it.options} onChange={(options) => updateItem(i, { options })} />
                      {it.options.length === 0 && <div className="text-danger small mt-1">選択肢を1つ以上追加してください</div>}
                    </>
                  )}
                  <div className={styles.keyNote}>キー: {it.fieldKey}</div>
                </div>
              ))}
            </Card.Body>
          </Card>
        </Col>

        <Col xl={5}>
          <Card className={styles.previewCard}>
            <Card.Header className={styles.sectionHeader}>
              <span>プレビュー</span>
              {dirty && <span className="small text-warning-emphasis">未保存</span>}
            </Card.Header>
            <Card.Body>
              <p className="text-muted small">報告書の月次報告欄・フッター部分がこの形になります（非表示の項目は出ません）。</p>
              <LayoutPreview layout={layout} />
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
