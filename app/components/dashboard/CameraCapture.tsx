// app/components/dashboard/CameraCapture.tsx
// Full-screen camera for the Status Input 写真追加 button: opens the device
// camera straight away, then holds the shot in a review step so nothing leaves
// the browser until the user presses 使用する.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Camera, ArrowRepeat, Check, Image as ImageIcon } from "react-bootstrap-icons";
import { Spinner } from "react-bootstrap";
import styles from "@/app/styles/CameraCapture.module.css";

type CameraCaptureProps = {
  onConfirm: (file: File) => void;
  onClose: () => void;
  // Offered when the camera can't be opened at all (no device, permission
  // denied, or an insecure origin where getUserMedia is unavailable).
  onFallbackToFile?: () => void;
};

type Shot = { file: File; url: string };

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

export default function CameraCapture({ onConfirm, onClose, onFallbackToFile }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // The confirmed shot is handed to the parent, so only an *abandoned* one gets
  // revoked here — tracked through a ref so cleanup doesn't need it as a dep.
  const shotRef = useRef<Shot | null>(null);

  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string>("");
  const [shot, setShot] = useState<Shot | null>(null);
  // Back camera by default — these are photos of a patient's meal/situation,
  // not selfies — with a flip button for devices that have both.
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  useEffect(() => {
    shotRef.current = shot;
  }, [shot]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // (Re)open the camera whenever the facing mode changes — but not while a shot
  // is under review, since the live feed is hidden then and the extra stream
  // would just hold the camera light on.
  useEffect(() => {
    if (shot) return;
    let cancelled = false;

    (async () => {
      setStarting(true);
      setError("");
      stopStream();

      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setError("このブラウザではカメラを利用できません。");
          setStarting(false);
        }
        return;
      }

      try {
        // facingMode is an ideal, not exact: desktops have one webcam that
        // matches neither value and would fail an exact constraint.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // iOS Safari won't autoplay from the attribute alone.
          await videoRef.current.play().catch(() => {});
        }
        setStarting(false);

        // Only meaningful once permission is granted — before that the device
        // labels/count are hidden, so this is deliberately after getUserMedia.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) {
            setHasMultipleCameras(devices.filter((d) => d.kind === "videoinput").length > 1);
          }
        } catch {
          /* device listing is optional */
        }
      } catch (e) {
        if (cancelled) return;
        console.error("failed to open camera", e);
        setError(errorMessage(e));
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [facingMode, shot, stopStream]);

  // Release the camera and any abandoned preview on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (shotRef.current) URL.revokeObjectURL(shotRef.current.url);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleShutter = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The front camera is mirrored on screen; un-mirror it so the saved photo
    // matches what the lens actually saw.
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const name = `photo-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
        const file = new File([blob], name, { type: "image/jpeg" });
        setShot({ file, url: URL.createObjectURL(file) });
        stopStream();
      },
      "image/jpeg",
      0.92
    );
  };

  const handleRetake = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null); // clearing this re-runs the open-camera effect
  };

  const handleConfirm = () => {
    if (!shot) return;
    stopStream();
    // Ownership of the object URL passes to the caller — don't revoke it here.
    shotRef.current = null;
    onConfirm(shot.file);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.topBar}>
        <span className={styles.title}>{shot ? "この写真を使いますか？" : "写真を撮影"}</span>
        <button type="button" className={styles.iconButton} onClick={onClose} title="閉じる" aria-label="閉じる">
          <X size={22} />
        </button>
      </div>

      <div className={styles.stage}>
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.url} alt="撮影した写真" className={styles.preview} />
        ) : (
          <>
            <video
              ref={videoRef}
              className={`${styles.video} ${facingMode === "user" ? styles.videoMirrored : ""}`}
              playsInline
              muted
              autoPlay
            />
            {starting && !error && (
              <div className={styles.overlayMessage}>
                <Spinner animation="border" variant="light" />
                <span>カメラを起動しています…</span>
              </div>
            )}
            {error && (
              <div className={styles.overlayMessage}>
                <span className={styles.errorText}>{error}</span>
                {onFallbackToFile && (
                  <button type="button" className={styles.textButton} onClick={onFallbackToFile}>
                    <ImageIcon size={16} />
                    <span>ファイルから選択</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.controls}>
        {shot ? (
          <>
            <button type="button" className={styles.secondaryButton} onClick={handleRetake}>
              <ArrowRepeat size={18} />
              <span>撮り直す</span>
            </button>
            <button type="button" className={styles.primaryButton} onClick={handleConfirm}>
              <Check size={20} />
              <span>この写真を使う</span>
            </button>
          </>
        ) : (
          <>
            <div className={styles.controlSlot}>
              {hasMultipleCameras && (
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setFacingMode((m) => (m === "environment" ? "user" : "environment"))}
                  title="カメラを切り替え"
                  aria-label="カメラを切り替え"
                >
                  <ArrowRepeat size={20} />
                </button>
              )}
            </div>
            <button
              type="button"
              className={styles.shutter}
              onClick={handleShutter}
              disabled={starting || !!error}
              aria-label="撮影"
            >
              <Camera size={26} />
            </button>
            <div className={styles.controlSlot} />
          </>
        )}
      </div>
    </div>
  );
}
