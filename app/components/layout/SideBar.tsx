// app/components/layout/SideBar.tsx

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Stack, Button } from "react-bootstrap";
import {
  BoxArrowRight,
  ChevronLeft,
  ChevronRight,
  PersonLinesFill,
  MicFill,
  FileText,
  GearFill,
} from "react-bootstrap-icons";
import styles from "@/app/styles/SideBar.module.css";

type SideBarProps = {
  employee_name: string;
  patient_name?: string | null;
  isExpanded: boolean;
  onToggle: () => void;
  onLogout: () => void;
};

const NAV_ITEMS = [
  { href: "/patients", label: "利用者選択", icon: PersonLinesFill },
  { href: "/", label: "状況入力", icon: MicFill },
  { href: "/report", label: "報告書", icon: FileText },
  { href: "/registerfield", label: "マスター", icon: GearFill },
];

const SideBar: React.FC<SideBarProps> = ({
  employee_name,
  patient_name,
  isExpanded,
  onToggle,
  onLogout,
}) => {
  const pathname = usePathname();

  return (
    <Stack direction="vertical" gap={2} className="h-100">
      <Button
        variant="custom"
        onClick={onToggle}
        className={styles.toggleButton}
        aria-label="Toggle Sidebar"
      >
        {isExpanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </Button>

      <div className={styles.profileCard} title={employee_name}>
        <div className={styles.avatar}>{employee_name.charAt(0)}</div>
        <span className={styles.employeeName}>{employee_name}</span>
      </div>

      {patient_name && (
        <div className={styles.patientCard} title={`利用者: ${patient_name}`}>
          利用者: <strong>{patient_name}</strong>
        </div>
      )}

      <nav className={styles.nav}>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link key={href} href={href} className="no-decoration" title={label}>
              <div
                className={`${styles.sidebarButton} ${isActive ? styles.sidebarButtonActive : ""}`}
              >
                <Icon size={20} />
                <span className={styles.buttonText}>{label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto" />
      <hr className={styles.hr} />

      <Button
        variant="custom"
        className={styles.sidebarButton}
        onClick={onLogout}
        title="ログアウト"
      >
        <BoxArrowRight size={20} />
        <span className={styles.buttonText}>ログアウト</span>
      </Button>
    </Stack>
  );
};

export default SideBar;
