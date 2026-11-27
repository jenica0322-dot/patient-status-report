// app/lib/voiceFlowResume.ts
// One-shot marker for "the user just came back to 状況入力 from another page"
// (報告書, マスター, …): Status Input sets it when it closes, and consumes it on
// its next mount to restart the Target Field voice-over from the first
// category (うけとり) without the mic being pressed again. sessionStorage (not
// module state) so it also survives a full reload/back navigation within the
// same tab.

const KEY = "voiceFlow:resumeAfterReport";

// The marker holds when it was set. One set less than this long ago isn't a
// real visit to another page — it's React re-mounting the screen in place
// (development StrictMode does this on every load) — so it's ignored; a real
// trip to another page and back always takes longer.
const MIN_AWAY_MS = 800;

export function markVoiceFlowResume() {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {}
}

// Returns true (once) if the marker was set, and clears it.
export function consumeVoiceFlowResume(): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return false;
    if (raw === "1") return true; // older marker without a time
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at >= MIN_AWAY_MS;
  } catch {
    return false;
  }
}
