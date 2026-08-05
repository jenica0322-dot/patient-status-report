// Shared normalization for matching spoken (Web Speech API) text against patient
// records. Kept separate from patient-name normalization so digit-reading quirks
// (see normalizeSpokenDigits) can never leak into name matching.

export function toHiragana(value: string) {
  return value.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

export function normalizeVoiceText(value: string) {
  return toHiragana(value)
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/[ーｰ]/g, "")
    .replace(/[・･]/g, "")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

const KANJI_DIGITS: Record<string, string> = {
  "〇": "0",
  "零": "0",
  "一": "1",
  "二": "2",
  "三": "3",
  "四": "4",
  "五": "5",
  "六": "6",
  "七": "7",
  "八": "8",
  "九": "9",
};

// Pulls a pure digit string out of spoken text for pat_id comparison: "0" is
// conventionally read "まる"/"れい" (not just "ゼロ") in Japanese ID numbers, and
// slow digit-by-digit speech sometimes transcribes as kanji numerals (一二三...).
// Never use this for name matching — "丸山"/"まるやま" contains "まる" and would
// otherwise mangle to "0やま".
export function normalizeSpokenDigits(value: string): string {
  const hira = toHiragana(value).toLowerCase();
  return hira
    .replace(/まる|ぜろ|れい/g, "0")
    .replace(/[〇零一二三四五六七八九]/g, (ch) => KANJI_DIGITS[ch] ?? ch)
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, "");
}
