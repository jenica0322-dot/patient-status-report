// app/lib/qrTargetUser.ts
// Extracts a Target User ID from a scanned QR code payload and looks up the
// matching patient. The QR payload may be a bare ID, a small JSON object, or
// a URL/query string carrying the ID under a recognizable key.

import { fetchPatients, Patient } from "./statusApi";

const ID_KEYS = [
  "targetUserId",
  "target_user_id",
  "patientId",
  "patient_id",
  "patId",
  "pat_id",
  "userId",
  "user_id",
  "id",
];

export function parseTargetUserId(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) return text;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      for (const key of ID_KEYS) {
        const value = (parsed as Record<string, unknown>)[key];
        if (value !== undefined && value !== null && String(value).trim()) {
          return String(value).trim();
        }
      }
    }
  } catch {
    /* not JSON */
  }

  try {
    const url = new URL(text);
    for (const key of ID_KEYS) {
      const value = url.searchParams.get(key);
      if (value) return value.trim();
    }
  } catch {
    /* not a URL */
  }

  const match = text.match(/(\d+)/);
  return match ? match[1] : null;
}

// Exact match only (by pat_id or internal id) — the QR code identifies one
// specific person, so a fuzzy/partial hit here would be a mismatch, not a fallback.
export async function findPatientByTargetUserId(id: string): Promise<Patient | null> {
  const page = await fetchPatients({ q: id, limit: 100 });
  return page.items.find((p) => String(p.pat_id ?? "") === id || String(p.id) === id) ?? null;
}
