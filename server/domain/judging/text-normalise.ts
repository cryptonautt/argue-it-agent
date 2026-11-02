/**
 * Unicode hygiene for untrusted submission text (design §4.3.1 and §4.3.4). Pure.
 *
 * Participants can type the same name or the same trigger words in many visually identical ways:
 * decomposed accents (NFD Yoruba names), fullwidth letters ("ＡＤＡ"), or invisible characters hidden inside a
 * word ("chidi\u200B_dev"). Blinding and the injection tripwire must not be defeated by that, so everything the
 * judge sees, and everything we match against, goes through `normaliseUntrustedText` first.
 */

/**
 * Invisible "format" characters (zero-width space/joiners, word joiner, BOM, bidi controls — all `\p{Cf}`),
 * plus the soft hyphen, combining grapheme joiner and Hangul fillers, which render as nothing.
 */
const INVISIBLE_CHARACTERS = /[\p{Cf}\u00AD\u034F\u115F\u1160\u3164\uFFA0]/gu;

/** An invisible character sitting between two letters/digits — someone splitting a word on purpose. */
const INVISIBLE_INSIDE_WORD = /[\p{L}\p{N}][\p{Cf}\u00AD\u034F]+[\p{L}\p{N}]/u;

/** NFKC (folds fullwidth/compatibility forms, composes accents) and remove invisible characters. */
export function normaliseUntrustedText(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE_CHARACTERS, "");
}

/** Index of the first invisible character hidden inside a word (a known evasion trick), or -1. */
export function findInvisibleCharacterInsideWord(text: string): number {
  return text.search(INVISIBLE_INSIDE_WORD);
}
