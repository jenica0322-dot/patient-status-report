// app/registerfield/optionInput.ts
// Shared by マスター's option inputs (フィールド情報 phrases, category options,
// 体調他-style follow-up choices).

import type React from "react";

// Several options can be typed at once, separated by 、 , ， ; ； or new
// lines — 「新聞、郵便、回覧板」 adds three. Blanks are dropped.
export function splitOptions(text: string): string[] {
  return text
    .split(/[、,，;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Adds the typed options to `existing`, skipping ones already there (or
// repeated in the input). Returns the new list and the skipped duplicates.
export function addOptions(existing: string[], text: string): { next: string[]; duplicates: string[] } {
  const next = [...existing];
  const duplicates: string[] = [];
  for (const o of splitOptions(text)) {
    if (next.includes(o)) duplicates.push(o);
    else next.push(o);
  }
  return { next, duplicates };
}

// Enter adds the typed option(s) — but not the Enter that confirms a Japanese
// IME conversion (かな → 漢字), which would otherwise add the unconverted text.
export function isAddEnter(e: React.KeyboardEvent): boolean {
  if (e.key !== "Enter") return false;
  const ne = e.nativeEvent as KeyboardEvent;
  return !(ne.isComposing || ne.keyCode === 229);
}
