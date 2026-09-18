// app/components/dashboard/QRScanner.tsx
// Full-screen camera overlay that continuously decodes video frames with
// jsQR until a code is found, then hands the raw scanned text back to the
// caller and stops itself. Mirrors CameraCapture's overlay/permission pattern.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { X } from "react-bootstrap-icons";
import { Spinner } from "react-bootstrap";
import styles from "@/app/styles/QRScanner.module.css";

type QRScannerProps = {
  onScan: (text: string) => void;
  onClose: () => void;
};

// A code must decode to the same value on every frame for this long, with no
// gaps, before it's accepted — filters out the momentary/garbled reads a QR
// code produces while it's still coming into focus or is still moving into
// the frame, so only a clearly-focused, stationary code triggers a scan.
const STABILITY_MS = 700;

function errorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "カメラの使用が許可されていません。ブラウザの設定でカメラを許可してください。";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "カメラが見つかりませんでした。";
  if (name === "NotReadableError")
    return "カメラを起動できませんでした。他のアプリがカメラを使用していないか確認してください。";
  return "カメラを起動できませんでした。";
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scannedRef = useRef(false);
  // Tracks the QR value currently being held steady, and when that streak
  // started — reset the moment a frame decodes something different or
  // nothing at all, so only an uninterrupted read counts toward the delay.
  const stableDataRef = useRef<string | null>(null);
  const stableSinceRef = useRef<number>(0);

  const [starting, setStarting] = useState(true);
  const [error, setError] = useState("");

  const stopStream = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const tick = useCallback(() => {
    if (scannedRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code?.data) {
          const now = performance.now();
          if (stableDataRef.current !== code.data) {
            stableDataRef.current = code.data;
            stableSinceRef.current = now;
          } else if (now - stableSinceRef.current >= STABILITY_MS) {
            scannedRef.current = true;
            stopStream();
            onScan(code.data);
            return;
          }
        } else {
          stableDataRef.current = null;
        }
      } else {
        stableDataRef.current = null;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onScan, stopStream]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setStarting(true);
      setError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setError("このブラウザではカメラを利用できません。");
          setStarting(false);
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        if (cancelled) return;
        setStarting(false);
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        if (cancelled) return;
        console.error("failed to open camera", e);
        setError(errorMessage(e));
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
    // Runs once per mount: opens the camera and kicks off the scan loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay}>
      <div className={styles.topBar}>
        <span className={styles.title}>対象利用者のQRコードを読み取ってください</span>
        <button type="button" className={styles.iconButton} onClick={onClose} title="閉じる" aria-label="閉じる">
          <X size={22} />
        </button>
      </div>

      <div className={styles.stage}>
        <video ref={videoRef} className={styles.video} playsInline muted autoPlay />
        <canvas ref={canvasRef} className={styles.hiddenCanvas} />
        {!error && <div className={styles.scanFrame} aria-hidden="true" />}
        {starting && !error && (
          <div className={styles.overlayMessage}>
            <Spinner animation="border" variant="light" />
            <span>カメラを起動しています…</span>
          </div>
        )}
        {error && (
          <div className={styles.overlayMessage}>
            <span className={styles.errorText}>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
