// app/report/page.tsx

"use client";

import { useEffect, useState, useMemo } from "react";
import { Container, Row, Col, Card, Form, Spinner, Alert, Button, Modal } from "react-bootstrap";
import { FileText, Calendar, FileEarmarkExcel, FileEarmarkPdf, Images, Trash } from "react-bootstrap-icons";
import Link from "next/link";
import Layout from "../components/layout/Layout";
import { JaMonthInput } from "../components/JaDatePicker";
import { usePatient } from "../context/PatientContext";
import {
  fetchStatusFields,
  fetchPatientReport,
  patientReportExportUrl,
  patientReportExportPdfUrl,
  fetchReportPhotos,
  deleteStatusPhoto,
  StatusPhoto,
} from "../lib/statusApi";
import PhotoLightbox from "../components/dashboard/PhotoLightbox";
import galleryStyles from "../styles/PhotoGallery.module.css";
import {
  ReportField,
  TALLY_GROUPS,
  FIELD_GROUP,
  WEEKDAY_JA,
  CIRCLED_NUMBERS,
  isChecked,
  textWithComment,
  checklistOptions,
  buildCommentBlocks,
  buildCommentRowPlan,
  groupColClass,
  tallyCategoryClass,
} from "../lib/reportFormat";
import styles from "../styles/MonthlyReportGrid.module.css";

const PATIENT_SELECT_FIELD_LABEL = "利用者選択";

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function Checklist({ field, value }: { field: ReportField | undefined; value: any }) {
  const options = checklistOptions(field, value);
  return (
    <span className={styles.checklist}>
      {options.map((o, i) => (
        <span
          key={i}
          className={`${styles.checklistOption} ${o.selected ? styles.checklistOptionOn : ""}`}
        >
          {o.selected ? "☑" : "☐"}
          {o.label}
        </span>
      ))}
    </span>
  );
}

export default function ReportPage() {
  const { selectedPatient } = usePatient();

  const patientId = selectedPatient?.id ?? null;
  const [yearMonth, setYearMonth] = useState(currentYearMonth());

  const [dailyFields, setDailyFields] = useState<ReportField[]>([]);
  const [monthlyFields, setMonthlyFields] = useState<ReportField[]>([]);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reportPhotos, setReportPhotos] = useState<StatusPhoto[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<number | null>(null);

  useEffect(() => {
    fetchStatusFields("daily_status").then(setDailyFields).catch(() => {});
    fetchStatusFields("monthly_report").then(setMonthlyFields).catch(() => {});
  }, []);

  useEffect(() => {
    if (!patientId) {
      setReport(null);
      return;
    }
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

  useEffect(() => {
    if (!patientId) {
      setReportPhotos([]);
      return;
    }
    fetchReportPhotos(patientId, yearMonth)
      .then(setReportPhotos)
      .catch((e) => {
        console.error("failed to load report photos", e);
        setReportPhotos([]);
      });
  }, [patientId, yearMonth]);

  const photoGroups = useMemo(() => {
    const groups = new Map<string, StatusPhoto[]>();
    for (const photo of reportPhotos) {
      const label = photo.record_date
        ? `${photo.record_date}`
        : photo.record_year_month
        ? `${photo.record_year_month}（月次報告）`
        : "その他";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(photo);
    }
    return Array.from(groups.entries());
  }, [reportPhotos]);

  const handleDeleteReportPhoto = async (photo: StatusPhoto) => {
    setDeletingPhotoId(photo.id);
    try {
      await deleteStatusPhoto(photo.id);
      setReportPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      setLightboxIndex((idx) => {
        if (idx === null) return idx;
        const remaining = reportPhotos.filter((p) => p.id !== photo.id);
        if (remaining.length === 0) return null;
        return Math.min(idx, remaining.length - 1);
      });
    } catch (e) {
      console.error("failed to delete photo", e);
    } finally {
      setDeletingPhotoId(null);
    }
  };

  const dfByKey = useMemo(
    () => Object.fromEntries(dailyFields.map((f) => [f.field_key, f])),
    [dailyFields]
  );
  const mfByKey = useMemo(
    () => Object.fromEntries(monthlyFields.map((f) => [f.field_key, f])),
    [monthlyFields]
  );
  const orderedDailyBody = useMemo(
    () =>
      dailyFields
        .filter(
          (f) =>
            f.field_key !== "youbi" &&
            f.field_key !== "uketori" &&
            f.field_label !== PATIENT_SELECT_FIELD_LABEL
        )
        .sort((a, b) => a.order_index - b.order_index),
    [dailyFields]
  );
  const commentBlocks = useMemo(() => buildCommentBlocks(monthlyFields), [monthlyFields]);
  const tallyRowKeys = useMemo(
    () => Object.entries(TALLY_GROUPS).flatMap(([group, keys]) => keys.map((k) => [group, k])),
    []
  );
  const commentRowPlan = useMemo(
    () => buildCommentRowPlan(tallyRowKeys.length, commentBlocks),
    [tallyRowKeys.length, commentBlocks]
  );

  const monthlyValues = report?.monthlyReport || {};
  const dayRowByDate = useMemo(() => {
    const m = new Map<string, any>();
    (report?.days || []).forEach((d: any) => m.set(d.record_date, d));
    return m;
  }, [report]);

  const [y, m] = yearMonth.split("-");

  // 日/曜/受取 + one column per daily field. The header-block rows above the grid
  // are hand-tuned to this specific 17-column template (16 daily_status fields);
  // the sections below derive their spans from it so they stay aligned if a
  // field is added or removed in registerfield.
  const totalCols = 3 + orderedDailyBody.length;
  const commentColSpan = totalCols - 8; // 分類(2) + 確認項目(4) + 件数(2)
  const footerShareColSpan = totalCols - 14; // 報告日(2+4) + 確認者(2+3) + label(3)

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

        <Card className={`mb-4 ${styles.noPrint} ${styles.toolbarCard}`}>
          <Card.Body>
            <Row className="g-3 align-items-end">
              <Col md={5} className={styles.toolbarUserCol}>
                <Form.Label>利用者</Form.Label>
                {selectedPatient ? (
                  <div className="form-control bg-light">
                    {selectedPatient.name}
                    <span className="text-muted small ms-2">
                      (pat_id {selectedPatient.pat_id ?? selectedPatient.id})
                    </span>
                  </div>
                ) : (
                  <div>
                    <div className="text-muted small mb-2">先に利用者を選択してください</div>
                    <Link href="/patients">
                      <Button variant="outline-primary" size="sm">
                        利用者選択へ
                      </Button>
                    </Link>
                  </div>
                )}
              </Col>
              <Col md={4} className={styles.toolbarDateCol}>
                <Form.Label>
                  <Calendar className="me-1" />
                  記録月
                </Form.Label>
                <JaMonthInput
                  className="form-control"
                  value={yearMonth}
                  onChange={setYearMonth}
                />
              </Col>
              <Col md={3} className={`text-md-end ${styles.toolbarActionsCol}`}>
                {patientId && (
                  <div className={`d-flex gap-2 justify-content-md-end ${styles.toolbarActions}`}>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      className="text-nowrap"
                      onClick={() => setShowGallery(true)}
                      disabled={reportPhotos.length === 0}
                    >
                      <Images className="me-1" />
                      写真を見る{reportPhotos.length > 0 ? `（${reportPhotos.length}）` : ""}
                    </Button>
                    <a
                      className="btn btn-success btn-sm text-nowrap"
                      href={patientReportExportUrl(patientId, yearMonth)}
                    >
                      <FileEarmarkExcel className="me-1" />
                      Excel印刷
                    </a>
                    <a
                      className="btn btn-danger btn-sm text-nowrap"
                      href={patientReportExportPdfUrl(patientId, yearMonth)}
                    >
                      <FileEarmarkPdf className="me-1" />
                      PDF印刷
                    </a>
                  </div>
                )}
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
          <Card className="mb-4">
            <Card.Body>
              <p className={styles.scrollHint}>← 横にスクロールできます →</p>
              <div className={styles.gridScroll}>
                <table className={styles.grid}>
                <tbody>
                  {/* Header block */}
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      利用者名
                    </td>
                    <td className={styles.valueCell} colSpan={5}>
                      {report.patient.name}
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      記録月
                    </td>
                    <td className={styles.valueCell} colSpan={8}>
                      {Number(y)}年　{Number(m)}月
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      配送担当
                    </td>
                    <td className={styles.valueCell} colSpan={5}>
                      <Checklist field={mfByKey.hasso_tanto} value={monthlyValues.hasso_tanto} />
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      食事内容
                    </td>
                    <td className={styles.valueCell} colSpan={8}>
                      <Checklist field={mfByKey.shokuji_naiyo} value={monthlyValues.shokuji_naiyo} />
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      利用回数
                    </td>
                    <td className={styles.valueCell} colSpan={5}>
                      {textWithComment(monthlyValues.riyo_kaisu)}
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      連絡方法
                    </td>
                    <td className={styles.valueCell} colSpan={8}>
                      <Checklist field={mfByKey.renraku_hoho} value={monthlyValues.renraku_hoho} />
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      報告先
                    </td>
                    <td className={styles.valueCell} colSpan={3}>
                      {textWithComment(monthlyValues.hokoku_saki)}
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      先方担当者
                    </td>
                    <td className={styles.valueCell} colSpan={3}>
                      {textWithComment(monthlyValues.senpo_tantosha)}
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      記入者
                    </td>
                    <td className={styles.valueCell} colSpan={5}>
                      {textWithComment(monthlyValues.kinyusha)}
                    </td>
                  </tr>

                  {/* Daily grid header */}
                  <tr className={styles.headerRow}>
                    <th style={{ width: 32 }}>日</th>
                    <th style={{ width: 36 }}>{dfByKey.youbi?.field_label || "曜"}</th>
                    <th style={{ width: 64 }}>{dfByKey.uketori?.field_label || "受取"}</th>
                    {orderedDailyBody.map((f) => (
                      <th key={f.field_key}>{f.field_label}</th>
                    ))}
                  </tr>

                  {/* Daily grid rows — always shows every day of the month, like the paper template */}
                  {Array.from({ length: report.daysInMonth || 0 }, (_, i) => i + 1).map((day) => {
                    const iso = `${yearMonth}-${String(day).padStart(2, "0")}`;
                    const dayRow = dayRowByDate.get(iso);
                    const values = dayRow?.values || {};
                    const weekday =
                      values.youbi?.value ?? values.youbi ?? WEEKDAY_JA[new Date(`${iso}T00:00:00`).getDay()];
                    return (
                      <tr key={iso}>
                        <td className={styles.colDay}>{day}</td>
                        <td className={styles.colWeekday}>{weekday}</td>
                        <td className={styles.colUketori}>{textWithComment(values.uketori)}</td>
                        {orderedDailyBody.map((f) => (
                          <td key={f.field_key} className={groupColClass(styles, FIELD_GROUP[f.field_key])}>
                            {f.field_type === "checkbox" ? (
                              isChecked(values[f.field_key]) ? (
                                <span className={styles.checkMark}>✓</span>
                              ) : (
                                ""
                              )
                            ) : (
                              textWithComment(values[f.field_key])
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}

                  {/* 月次報告欄 */}
                  <tr>
                    <td colSpan={3 + orderedDailyBody.length} className={styles.sectionBar}>
                      月次報告欄
                    </td>
                  </tr>
                  <tr className={styles.headerRow}>
                    <th colSpan={2}>分類</th>
                    <th colSpan={4}>確認項目</th>
                    <th colSpan={2}>件数</th>
                    <th colSpan={commentColSpan}>
                      報告書コメント欄｜該当するものに✓＋必要時のみ一言
                    </th>
                  </tr>
                  {tallyRowKeys.map(([group, key], idx) => {
                    const label = dfByKey[key]?.field_label || key;
                    const count = report.tallies?.[group]?.[key] ?? 0;
                    const slot = commentRowPlan[idx];
                    return (
                      <tr key={key}>
                        <td className={`${styles.tallyCategory} ${tallyCategoryClass(styles, group)}`} colSpan={2}>
                          {group}
                        </td>
                        <td className={styles.valueCell} colSpan={4}>
                          {label}
                        </td>
                        <td className={styles.tallyCount} colSpan={2}>
                          {count}
                        </td>
                        {slot === "skip" ? null : (
                          <td
                            className={styles.commentCell}
                            colSpan={commentColSpan}
                            rowSpan={slot ? slot.span : 1}
                          >
                            {slot && (
                              <>
                                <div style={{ fontWeight: 700, marginBottom: 2 }}>
                                  {CIRCLED_NUMBERS[slot.block.number - 1] || `${slot.block.number}.`}
                                  {slot.block.field.field_label}
                                </div>
                                <Checklist field={slot.block.field} value={monthlyValues[slot.block.field.field_key]} />
                                {slot.block.freeTextSuffix && (
                                  <div className="mt-1">
                                    {slot.block.freeTextSuffix}：
                                    {slot.block.freeTextField
                                      ? textWithComment(monthlyValues[slot.block.freeTextField.field_key])
                                      : ""}
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}

                  {/* 総評 */}
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      総評
                    </td>
                    <td className={styles.commentCell} colSpan={totalCols - 2}>
                      {textWithComment(monthlyValues.sohyo)}
                    </td>
                  </tr>

                  {/* Footer */}
                  <tr>
                    <td className={styles.labelCell} colSpan={2}>
                      報告日
                    </td>
                    <td className={styles.valueCell} colSpan={4}>
                      {textWithComment(monthlyValues.hokokubi)}
                    </td>
                    <td className={styles.labelCell} colSpan={2}>
                      確認者
                    </td>
                    <td className={styles.valueCell} colSpan={3}>
                      {textWithComment(monthlyValues.kakuninsha)}
                    </td>
                    <td className={styles.labelCell} colSpan={3}>
                      家族・関係機関共有
                    </td>
                    <td className={styles.valueCell} colSpan={footerShareColSpan}>
                      <Checklist field={mfByKey.kyoyu_status} value={monthlyValues.kyoyu_status} />
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </Card.Body>
          </Card>
        )}
      </Container>

      <Modal show={showGallery} onHide={() => setShowGallery(false)} centered size="xl" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>
            写真一覧 {report?.patient?.name ? `｜${report.patient.name}` : ""}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {photoGroups.length === 0 ? (
            <p className={galleryStyles.galleryEmpty}>この月にアップロードされた写真はありません</p>
          ) : (
            photoGroups.map(([label, groupPhotos]) => (
              <div key={label} className={galleryStyles.galleryGroup}>
                <div className={galleryStyles.galleryGroupLabel}>{label}</div>
                <div className={galleryStyles.galleryGrid}>
                  {groupPhotos.map((photo) => (
                    <div
                      key={photo.id}
                      className={galleryStyles.galleryThumb}
                      role="button"
                      tabIndex={0}
                      onClick={() => setLightboxIndex(reportPhotos.findIndex((p) => p.id === photo.id))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setLightboxIndex(reportPhotos.findIndex((p) => p.id === photo.id));
                        }
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt={photo.original_filename || "写真"} />
                      <button
                        type="button"
                        className={galleryStyles.galleryThumbDelete}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteReportPhoto(photo);
                        }}
                        disabled={deletingPhotoId === photo.id}
                        title="削除"
                      >
                        {deletingPhotoId === photo.id ? (
                          <Spinner animation="border" size="sm" />
                        ) : (
                          <Trash size={12} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </Modal.Body>
      </Modal>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={reportPhotos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onDelete={handleDeleteReportPhoto}
          deletingId={deletingPhotoId}
        />
      )}
    </Layout>
  );
}
