// app/components/layout/Layout.tsx

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Offcanvas } from "react-bootstrap";
import NavHeader from "./NavHeader";
import SideBar from "./SideBar";
import styles from "@/app/styles/SideBar.module.css";
import { useAuth } from "@/app/context/AuthContext";
import { usePatient } from "@/app/context/PatientContext";
import { Download } from "react-bootstrap-icons";
import layoutStyles from "@/app/styles/Layout.module.css";
import { usePathname } from "next/navigation";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>;
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const useIsDesktop = (query: string) => {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia(query);

      const listener = (event: MediaQueryListEvent) => {
        setIsDesktop(event.matches);
      };

      setIsDesktop(mediaQuery.matches);

      mediaQuery.addEventListener('change', listener);

      return () => {
        mediaQuery.removeEventListener('change', listener);
      };
    }
  }, [query]);

  return isDesktop;
};

type LayoutProps = {
  children: React.ReactNode;
};

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [showOffcanvas, setShowOffcanvas] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  const { user, logout } = useAuth();
  const { selectedPatient } = usePatient();
  const isDesktop = useIsDesktop("(min-width: 768px)");
  const pathname = usePathname();

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
    };
  }, []);

  useEffect(() => {
    let title = "状況記録表兼報告書";
    if (pathname === "/") title += " - 状況入力";
    else if (pathname === "/report") title += " - 報告書";
    else if (pathname === "/registerfield") title += " - マスター";
    else if (pathname === "/patients") title += " - 利用者選択";
    document.title = title;
  }, [pathname]);

  useEffect(() => {
    setHasMounted(true);
    const savedState = localStorage.getItem("sidebarExpanded");
    if (savedState !== null) {
      setIsSidebarExpanded(JSON.parse(savedState));
    }
  }, []);

  useEffect(() => {
    if (hasMounted) {
      localStorage.setItem(
        "sidebarExpanded",
        JSON.stringify(isSidebarExpanded)
      );
    }
  }, [isSidebarExpanded, hasMounted]);

  const handleToggleSidebar = () => setIsSidebarExpanded((prev) => !prev);
  const handleShowOffcanvas = () => setShowOffcanvas(true);
  const handleHideOffcanvas = () => setShowOffcanvas(false);

  const handleInstallClick = async () => {
    if (!installPrompt) {
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setIsInstallable(false);
  };

  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  const employeeName = user?.username || "Guest";
  const patientName = selectedPatient?.name || null;

  if (!hasMounted) {
    return null;
  }

  const mobileMenuOpen = !isDesktop && showOffcanvas;

  return (
    <>
      {isInstallable && !mobileMenuOpen && (
        <button
          className={layoutStyles.installButton}
          onClick={handleInstallClick}
          title="Install App"
        >
          <Download size={20} />
          <span className={layoutStyles.installButtonText}>Install App</span>
        </button>
      )}

      <NavHeader
        onMenuClick={handleShowOffcanvas}
        employee_name={employeeName}
        patient_name={patientName}
        isDesktop={isDesktop}
        isSidebarExpanded={isSidebarExpanded}
        reserveInstallButtonSpace={isInstallable}
      />

      {isDesktop && (
        <div
          className={`${styles.sidebar} ${
            isSidebarExpanded ? styles.sidebarExpanded : styles.sidebarCollapsed
          }`}
        >
          <SideBar
            employee_name={employeeName}
            patient_name={patientName}
            isExpanded={isSidebarExpanded}
            onToggle={handleToggleSidebar}
            onLogout={handleLogout}
          />
        </div>
      )}

      <Offcanvas
        show={!isDesktop && showOffcanvas}
        onHide={handleHideOffcanvas}
        placement="start"
        className={styles.offcanvas}
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>メニュー</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <SideBar
            employee_name={employeeName}
            patient_name={patientName}
            isExpanded={true}
            onToggle={handleHideOffcanvas}
            onLogout={handleLogout}
          />
        </Offcanvas.Body>
      </Offcanvas>

      <main
        className={`${styles.contentWrapper} ${
          isDesktop
            ? isSidebarExpanded
              ? styles.contentWrapperExpanded
              : styles.contentWrapperCollapsed
            : ""
        } animate-in`}
        key={pathname}
      >
        {children}
      </main>
    </>
  );
};

export default Layout;
