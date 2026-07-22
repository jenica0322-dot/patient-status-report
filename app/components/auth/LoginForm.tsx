// app/components/auth/LoginForm.tsx

"use client";

import { useState } from "react";
import { Form, Button, Alert, InputGroup } from "react-bootstrap";
import { ClipboardHeart, EyeFill, EyeSlashFill, PersonFill, KeyFill } from "react-bootstrap-icons";
import { useAuth } from "@/app/context/AuthContext";
import styles from "@/app/styles/LoginForm.module.css";

export default function LoginForm() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const success = await login(username, password);

      if (!success) {
        setError("ユーザー名またはパスワードが無効です");
      }
    } catch (err) {
      console.error(err);
      setError("予期せぬエラーが発生しました。");
    } finally {
      setSubmitting(false);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.iconBadge}>
          <ClipboardHeart size={26} />
        </div>
        <h3 className={styles.title}>ログイン</h3>
        <p className={styles.subtitle}>状況記録表兼報告書へようこそ</p>

        <Form onSubmit={handleSubmit}>
          {error && (
            <Alert variant="danger" className="py-2">
              {error}
            </Alert>
          )}

          <Form.Group className="mb-3" controlId="formUsername">
            <Form.Label>ユーザー名</Form.Label>
            <InputGroup>
              <InputGroup.Text>
                <PersonFill />
              </InputGroup.Text>
              <Form.Control
                type="text"
                placeholder="ユーザー名を入力してください (例: admin)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </InputGroup>
          </Form.Group>

          <Form.Group className="mb-4" controlId="formPassword">
            <Form.Label>パスワード</Form.Label>
            <InputGroup>
              <InputGroup.Text>
                <KeyFill />
              </InputGroup.Text>
              <Form.Control
                type={showPassword ? "text" : "password"}
                placeholder="パスワードを入力してください"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button
                variant="outline-secondary"
                onClick={togglePasswordVisibility}
                aria-label={showPassword ? "パスワードを非表示" : "パスワードを表示"}
              >
                {showPassword ? <EyeSlashFill /> : <EyeFill />}
              </Button>
            </InputGroup>
          </Form.Group>

          <div className="d-grid">
            <Button variant="primary" type="submit" size="lg" disabled={submitting}>
              {submitting ? "ログイン中…" : "ログイン"}
            </Button>
          </div>
        </Form>
      </div>
    </div>
  );
}
