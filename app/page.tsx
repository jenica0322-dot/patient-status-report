// app/page.tsx

"use client";

import { useAuth } from "./context/AuthContext";
import LoginForm from "./components/auth/LoginForm";
import StatusMatcher from "./components/dashboard/StatusMatcher";
import Layout from "./components/layout/Layout";

export default function Home() {
  const { isLoggedIn } = useAuth();

  if (!isLoggedIn) {
    return <LoginForm />;
  }

  return (
    <Layout>
      <StatusMatcher />
    </Layout>
  );
}
