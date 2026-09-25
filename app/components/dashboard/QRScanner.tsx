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

// A code is accepted only after it has been held fully inside the on-screen
// scan frame, decoding to the same value and without moving, for at least
// STABILITY_MS (and on at least STABLE_READS frames) — so a code that's still
// being brought into position, or merely passes through the camera's view,
// never triggers a scan.
const STABLE_READS = 3;
const STABILITY_MS = 700;
// One frame that fails to decode (motion blur, autofocus hunting) doesn't
// reset the streak; a second miss in a row, or a different value, does.
const MAX_MISSED_FRAMES = 1;
// If the code's center drifts more than this fraction of the scan frame's
// width from where the streak started, it's still being positioned — the
// hold timer starts over from that new position.
const MAX_DRIFT_RATIO = 0.12;
// jsQR fallback decodes a downscaled copy of the frame: far cheaper than the
// full 1280x720 and still ample resolution for a code filling the scan frame.
const JSQR_MAX_DIMENSION = 800;

type Point = { x: number; y: number };
// A decoded code with its corner points in the video's own pixel coordinates.
type Detection = { data: string; corners: Point[] };

type NativeDetector = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string; cornerPoints?: Point[] }>>;
};

// Uses the browser's built-in QR detector (Chrome/Edge on Android, etc.)
// where available — it decodes natively, much faster than jsQR in JS.
async function createNativeDetector(): Promise<NativeDetector | null> {
  const BD = (window as any).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats: string[] = await BD.getSupportedFormats();
    if (!formats.includes("qr_code")) return null;
    return new BD({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

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
  // Tracks the QR value currently being held steady, when that streak
  // started, how many frames confirmed it, and how many frames in a row have
  // missed since — reset when a frame decodes something different or too
  // many frames in a row decode nothing.
  const stableDataRef = useRef<string | null>(null);
  const stableSinceRef = useRef<number>(0);
  const stableCountRef = useRef(0);
  const stableCenterRef = useRef<Point | null>(null);
  const missedRef = useRef(0);
  const scanFrameRef = useRef<HTMLDivElement | null>(null);
  const detectorRef = useRef<NativeDetector | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const [starting, setStarting] = useState(true);
  const [error, setError] = useState("");

  const stopStream = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetStreak = () => {
    stableDataRef.current = null;
    stableCountRef.current = 0;
    stableCenterRef.current = null;
  };

  // Maps the code's corners from video pixels to screen coordinates (the
  // video is shown with object-fit: contain, so account for letterboxing) and
  // returns them, or null if the frame/video layout isn't measurable yet.
  const toScreenCorners = (video: HTMLVideoElement, corners: Point[]): Point[] | null => {
    const vr = video.getBoundingClientRect();
    if (!vr.width || !vr.height || !video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(vr.width / video.videoWidth, vr.height / video.videoHeight);
    const offX = vr.left + (vr.width - video.videoWidth * scale) / 2;
    const offY = vr.top + (vr.height - video.videoHeight * scale) / 2;
    return corners.map((p) => ({ x: offX + p.x * scale, y: offY + p.y * scale }));
  };

  // Feeds one frame's result into the stability check; returns true once the
  // code is accepted and handed to onScan. A code that's decoded but not
  // fully inside the scan frame counts as not-yet-positioned and resets the
  // streak, so the hold timer only runs while it's properly placed.
  const handleResult = useCallback(
    (video: HTMLVideoElement, detection: Detection | null): boolean => {
      const now = performance.now();
      if (!detection) {
        missedRef.current += 1;
        if (missedRef.current > MAX_MISSED_FRAMES) resetStreak();
        return false;
      }
      missedRef.current = 0;

      const frame = scanFrameRef.current?.getBoundingClientRect();
      const screen = toScreenCorners(video, detection.corners);
      if (!frame || !frame.width || !screen || screen.length < 4) {
        resetStreak();
        return false;
      }
      const inside = screen.every(
        (p) => p.x >= frame.left && p.x <= frame.right && p.y >= frame.top && p.y <= frame.bottom
      );
      if (!inside) {
        resetStreak();
        return false;
      }
      const center = {
        x: screen.reduce((s, p) => s + p.x, 0) / screen.length,
        y: screen.reduce((s, p) => s + p.y, 0) / screen.length,
      };

      const anchor = stableCenterRef.current;
      const drifted =
        anchor != null && Math.hypot(center.x - anchor.x, center.y - anchor.y) > frame.width * MAX_DRIFT_RATIO;
      if (stableDataRef.current !== detection.data || drifted) {
        stableDataRef.current = detection.data;
        stableSinceRef.current = now;
        stableCountRef.current = 1;
        stableCenterRef.current = center;
        return false;
      }
      stableCountRef.current += 1;
      if (stableCountRef.current >= STABLE_READS && now - stableSinceRef.current >= STABILITY_MS) {
        scannedRef.current = true;
        stopStream();
        onScan(detection.data);
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onScan, stopStream]
  );

  const decodeWithJsQR = useCallback((video: HTMLVideoElement): Detection | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const scale = Math.min(1, JSQR_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    // Only resize when the dimensions change — assigning width/height
    // reallocates the canvas backing store every frame otherwise.
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (!ctxRef.current) ctxRef.current = canvas.getContext("2d", { willReadFrequently: true });
    const ctx = ctxRef.current;
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    // Printed QR codes are dark-on-light; skipping the inverted pass halves
    // the cost of every frame that doesn't contain a code.
    const code = jsQR(imageData.data, w, h, { inversionAttempts: "dontInvert" });
    if (!code?.data) return null;
    // Corner points come back in the downscaled canvas's coordinates.
    const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = code.location;
    const corners = [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner].map((p) => ({
      x: p.x / scale,
      y: p.y / scale,
    }));
    return { data: code.data, corners };
  }, []);

  const tick = useCallback(async () => {
    if (scannedRef.current) return;
    const video = videoRef.current;
    if (video && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      let detection: Detection | null = null;
      const detector = detectorRef.current;
      if (detector) {
        try {
          const codes = await detector.detect(video);
          const code = codes.find((c) => c.rawValue);
          if (code?.cornerPoints?.length) {
            detection = { data: code.rawValue, corners: code.cornerPoints };
          } else if (code) {
            // No corner positions from this implementation — jsQR supplies
            // them so the in-frame check still applies.
            detection = decodeWithJsQR(video);
          }
        } catch {
          // Native detector failed on this device — use jsQR from now on.
          detectorRef.current = null;
          detection = decodeWithJsQR(video);
        }
      } else {
        detection = decodeWithJsQR(video);
      }
      // Closed/unmounted while an async detect was in flight.
      if (scannedRef.current || !streamRef.current) return;
      if (handleResult(video, detection)) return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [decodeWithJsQR, handleResult]);

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
        // Ask for continuous autofocus where supported so the code sharpens
        // sooner; ignored by cameras/browsers that don't support it.
        const [track] = stream.getVideoTracks();
        track?.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] }).catch(() => {});
        detectorRef.current = await createNativeDetector();
        if (cancelled) return;
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
        {!error && <div ref={scanFrameRef} className={styles.scanFrame} aria-hidden="true" />}
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
