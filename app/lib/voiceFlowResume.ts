// app/lib/voiceFlowResume.ts
// One-shot marker for "the user just came back from reviewing the 報告書":
// the report screen sets it, and Status Input consumes it on its next mount
// to restart the Target Field voice-over. sessionStorage (not module state)
// so it also survives a full reload/back navigation within the same tab.

const KEY = "voiceFlow:resumeAfterReport";

export function markVoiceFlowResume() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {}
}

// Returns true (once) if the marker was set, and clears it.
export function consumeVoiceFlowResume(): boolean {
  try {
    const set = sessionStorage.getItem(KEY) === "1";
    sessionStorage.removeItem(KEY);
    return set;
  } catch {
    return false;
  }
}
