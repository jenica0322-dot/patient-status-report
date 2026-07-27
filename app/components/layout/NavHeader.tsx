// app/components/layout/NavHeader.tsx
"use client";

import React from "react";
import { Navbar, Container, Nav, Button } from "react-bootstrap";
import { List, PersonCircle, ClipboardHeart } from "react-bootstrap-icons";
import styles from "@/app/styles/NavHeader.module.css";

type NavHeaderProps = {
  employee_name: string;
  patient_name?: string | null;
  onMenuClick: () => void;
  isDesktop: boolean;
  isSidebarExpanded: boolean;
  reserveInstallButtonSpace?: boolean;
};

const NavHeader: React.FC<NavHeaderProps> = ({
  employee_name,
  patient_name,
  onMenuClick,
  isDesktop,
  isSidebarExpanded,
  reserveInstallButtonSpace,
}) => {
  const collapsedWidth = 80;
  const expandedWidth = 260;

  const headerStyle: React.CSSProperties = isDesktop
    ? {
        marginLeft: isSidebarExpanded ? expandedWidth : collapsedWidth,
        width: `calc(100% - ${isSidebarExpanded ? expandedWidth : collapsedWidth}px)`,
        transition: "margin-left 0.3s ease-in-out, width 0.3s ease-in-out",
        left: 0,
      }
    : {
        marginLeft: 0,
        width: "100%",
      };

  return (
    <Navbar
      expand="lg"
      className={styles.appHeader}
      fixed="top"
      style={headerStyle}
    >
      <Container fluid>
        <Button
          variant="outline-secondary"
          className={`d-md-none me-2 ${styles.menuButton}`}
          onClick={onMenuClick}
        >
          <List size={24} />
        </Button>

        <Navbar.Brand href="/" className={styles.headerBrand}>
          <span className={styles.brandIcon}>
            <ClipboardHeart size={18} />
          </span>
          <span className={styles.headerTitle}>状況記録表兼報告書</span>
          {patient_name && (
            <span className={styles.patientBadge}>{patient_name} さん</span>
          )}
        </Navbar.Brand>

        <Nav
          className={`ms-auto ${reserveInstallButtonSpace ? styles.reserveInstallSpace : ""}`}
        >
          <div className={styles.welcomeContainer}>
            <PersonCircle size={20} className={styles.welcomeIcon} />
            <span className={`${styles.welcomeText} d-none d-md-inline`}>
              ようこそ, {employee_name}さん
            </span>
            <span className={`${styles.welcomeText} d-md-none`}>
              {employee_name}さん
            </span>
          </div>
        </Nav>
      </Container>
    </Navbar>
  );
};

export default NavHeader;
