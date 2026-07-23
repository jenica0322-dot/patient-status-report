"use client";

import DatePicker, { registerLocale } from "react-datepicker";
import { ja } from "date-fns/locale/ja";
import "react-datepicker/dist/react-datepicker.css";
import styles from "./JaDatePicker.module.css";

registerLocale("ja", ja);

function parseYmd(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m) return null;
  return new Date(y, m - 1, d || 1);
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatYm(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

type BaseProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  maxWidth?: number;
};

export function JaDateInput({ value, onChange, className, maxWidth = 210 }: BaseProps) {
  return (
    <div style={{ maxWidth }}>
      <DatePicker
        locale="ja"
        dateFormat="yyyy年MM月dd日(EEEEE)"
        selected={parseYmd(value)}
        onChange={(date: Date | null) => date && onChange(formatYmd(date))}
        className={className}
        wrapperClassName={styles.wrapper}
      />
    </div>
  );
}

export function JaMonthInput({ value, onChange, className, maxWidth = 180 }: BaseProps) {
  const [y, m] = value ? value.split("-").map(Number) : [];
  const selected = y && m ? new Date(y, m - 1, 1) : null;

  return (
    <div style={{ maxWidth }}>
      <DatePicker
        locale="ja"
        dateFormat="yyyy年MM月"
        showMonthYearPicker
        selected={selected}
        onChange={(date: Date | null) => date && onChange(formatYm(date))}
        className={className}
        wrapperClassName={styles.wrapper}
      />
    </div>
  );
}
