// app/page.tsx

"use client";

import Link from "next/link";
import { Card, Button } from "react-bootstrap";
import { PersonLinesFill } from "react-bootstrap-icons";
import { useAuth } from "./context/AuthContext";
import { usePatient } from "./context/PatientContext";
import LoginForm from "./components/auth/LoginForm";
import StatusMatcher from "./components/dashboard/StatusMatcher";
import Layout from "./components/layout/Layout";

export default function Home() {
  const { isLoggedIn } = useAuth();
  const { selectedPatient } = usePatient();

  if (!isLoggedIn) {
    return <LoginForm />;
  }

  return (
    <Layout>
      {selectedPatient ? (
        <StatusMatcher />
      ) : (
        <div className="container-fluid py-5 d-flex justify-content-center">
          <Card className="text-center" style={{ maxWidth: 460 }}>
            <Card.Body className="p-5">
              <div
                className="d-flex align-items-center justify-content-center mx-auto mb-3"
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "var(--radius-lg)",
                  background: "var(--gradient-primary)",
                  color: "#fff",
                }}
              >
                <PersonLinesFill size={28} />
              </div>
              <h5 className="mb-2 fw-bold">先に利用者を選択してください</h5>
              <p className="text-muted mb-4">
                状況を記録するには、まず利用者選択画面で利用者を選んでください。
              </p>
              <Link href="/patients" passHref>
                <Button variant="primary" size="lg">利用者選択へ</Button>
              </Link>
            </Card.Body>
          </Card>
        </div>
      )}
    </Layout>
  );
}
