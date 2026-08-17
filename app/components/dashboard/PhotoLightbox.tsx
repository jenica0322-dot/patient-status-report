// app/components/dashboard/PhotoLightbox.tsx
// Full-screen viewer for a list of StatusPhoto — shared by the Status Input
// upload strip and the Report page's photo gallery.
"use client";

import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Trash, Download } from "react-bootstrap-icons";
import { Spinner } from "react-bootstrap";
import styles from "@/app/styles/PhotoLightbox.module.css";
import { StatusPhoto } from "@/app/lib/statusApi";

type PhotoLightboxProps = {
  photos: StatusPhoto[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onDelete?: (photo: StatusPhoto) => void;
  deletingId?: number | null;
};

function formatCaption(photo: StatusPhoto): string {
  const date = photo.record_date || photo.record_year_month;
  return [date, photo.original_filename].filter(Boolean).join(" ・ ");
}

export default function PhotoLightbox({
  photos,
  index,
  onClose,
  onIndexChange,
  onDelete,
  deletingId,
}: PhotoLightboxProps) {
  const photo = photos[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      else if (e.key === "ArrowRight" && index < photos.length - 1) onIndexChange(index + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, photos.length, onClose, onIndexChange]);

  if (!photo) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.topBar} onClick={(e) => e.stopPropagation()}>
        <span className={styles.caption}>{formatCaption(photo)}</span>
        <div className={styles.topBarActions}>
          <a
            className={styles.iconButton}
            href={photo.url}
            download={photo.original_filename || undefined}
            title="ダウンロード"
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={18} />
          </a>
          {onDelete && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(photo);
              }}
              disabled={deletingId === photo.id}
              title="削除"
            >
              {deletingId === photo.id ? <Spinner animation="border" size="sm" /> : <Trash size={18} />}
            </button>
          )}
          <button type="button" className={styles.iconButton} onClick={onClose} title="閉じる">
            <X size={22} />
          </button>
        </div>
      </div>

      <div className={styles.stage} onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button
            type="button"
            className={`${styles.navButton} ${styles.navPrev}`}
            onClick={() => onIndexChange(index - 1)}
            aria-label="前の写真"
          >
            <ChevronLeft size={28} />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={photo.original_filename || "写真"} className={styles.image} />
        {index < photos.length - 1 && (
          <button
            type="button"
            className={`${styles.navButton} ${styles.navNext}`}
            onClick={() => onIndexChange(index + 1)}
            aria-label="次の写真"
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>

      {photos.length > 1 && (
        <div className={styles.counter} onClick={(e) => e.stopPropagation()}>
          {index + 1} / {photos.length}
        </div>
      )}
    </div>
  );
}
