/**
 * Heuristic prompt-injection pre-scan (design §4.3.4). Pure.
 *
 * This is a tripwire, not the defence: the real defence is the prompt (submissions are delimited untrusted
 * data and any instructions inside them are scored as irrelevant content). A match is recorded on the
 * evaluation and opens an automatic moderation report; it never changes scores by itself, so a false
 * positive cannot hurt an honest debater and a true positive cannot help anyone.
 */
import { findInvisibleCharacterInsideWord, normaliseUntrustedText } from "./text-normalise";
import type { InjectionScanResult } from "./types";
import type { InjectionFinding } from "@domain/db/json-types";

export interface InjectionPattern {
  id: string;
  regex: RegExp;
}

/** Ordered, named heuristics. Kept conservative to limit false positives on ordinary debate text. */
export const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    id: "ignore_instructions",
    regex:
      /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}?\b(?:previous|prior|above|earlier|all|any|your|the|these|those|system)\b[^.\n]{0,30}?\b(?:instructions?|prompts?|rules?|directions?|guidelines?|rubric|criteria)\b/iu,
  },
  {
    id: "role_override",
    // "you are now" / "you are no longer" only count when followed by a role noun: "So you are now saying Messi
    // is better?" is everyday (Nigerian) English and must never open a report against an honest debater.
    regex:
      /\b(?:you are (?:now|no longer)(?: an?| the| my)?(?: \w+){0,2} (?:ai|judge|assistant|model|evaluator|grader|referee|chatbot|\w*bot)|from now on,? you|act as (?:the |a |an )?(?:judge|ai|assistant|system)|pretend (?:to be|you are)|new instructions?|system prompt|developer mode|jailbreak)\b/iu,
  },
  {
    id: "verdict_steering",
    regex:
      /\b(?:ai|judge|model|assistant|claude|chatgpt|gpt|grader|evaluator|you)\b[^.\n]{0,40}?\b(?:must|should|will|shall|have to|need to|are required to)\b[^.\n]{0,30}?\b(?:declare|score|rate|pick|choose|award|give|vote|rule)\b[^.\n]{0,40}?\b(?:me|us|this side|my side|side [ab]|winner|win|10|full marks|maximum|highest|zero|0)\b/iu,
  },
  {
    id: "self_award",
    regex:
      /\b(?:declare|award|give|score|rate)\b\s+(?:me|us|this side|my side|side [ab])\b[^.\n]{0,30}?\b(?:winner|the win|victory|10\s*(?:\/|out of)\s*10|full marks|maximum|highest)\b/iu,
  },
  {
    id: "hidden_comment",
    // Markup comments are invisible to the human reader of a rendered page but not to a model.
    regex: /<!--[\s\S]{0,2000}?(?:-->|$)/u,
  },
  {
    id: "fake_notice",
    // Bracketed "official" notices and claims that the judging was already decided.
    regex:
      /\[\s*(?:system|admin(?:istrator)?|moderator|platform|official|argue\s*it|judg(?:e|es|ing))\b[^\]\n]{0,60}\]|\b(?:judg(?:es|ing panel)|the panel|the ai|moderators?|admins?|the platform)\b[^.\n]{0,40}?\b(?:already|has|have)\b[^.\n]{0,30}?\b(?:decided|ruled|determined|chosen)\b[^.\n]{0,30}?\b(?:side [ab]|winner|wins?)\b/iu,
  },
  {
    id: "fake_delimiter",
    regex:
      /<\/?\s*(?:system|assistant|user|instructions?|submission|data|rubric|im_start|im_end)\b[^>]{0,40}>|<<<|>>>|\[\/?(?:system|inst)\]|```\s*(?:system|json)/iu,
  },
  {
    id: "output_tampering",
    regex: /"\s*(?:winner|confidence|margin|score)\s*"\s*:|\b(?:output|return|respond with|print)\b[^.\n]{0,20}?\b(?:winner|verdict|confidence)\s*[:=]/iu,
  },
];

/** Recorded when invisible characters split a word — the text was crafted to slip past filters. */
export const HIDDEN_CHARACTERS_PATTERN = "hidden_characters";

/** Max findings per scanned text (one per pattern is enough to flag; keeps records small). */
const MAX_FINDINGS = INJECTION_PATTERNS.length;
const EXCERPT_RADIUS = 60;
export const MAX_EXCERPT_LENGTH = 160;

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + length + EXCERPT_RADIUS);
  const raw = `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  const flat = raw.replace(/\s+/gu, " ").trim();
  return flat.length <= MAX_EXCERPT_LENGTH ? flat : `${flat.slice(0, MAX_EXCERPT_LENGTH - 1)}…`;
}

/**
 * Scan one submission's text. Findings carry `side`/`round` = null; the caller fills them in.
 * The text is Unicode-normalised first (zero-width characters cannot split trigger words), and invisible
 * characters inside words are a finding of their own.
 */
export function scanForInjection(rawText: string): InjectionScanResult {
  const findings: InjectionFinding[] = [];
  const text = normaliseUntrustedText(rawText);
  const hiddenAt = findInvisibleCharacterInsideWord(rawText);
  if (hiddenAt >= 0) {
    const excerpt = normaliseUntrustedText(excerptAround(rawText, hiddenAt, 2));
    findings.push({ pattern: HIDDEN_CHARACTERS_PATTERN, excerpt, side: null, round: null });
  }
  for (const { id, regex } of INJECTION_PATTERNS) {
    const match = regex.exec(text);
    if (!match) continue;
    findings.push({ pattern: id, excerpt: excerptAround(text, match.index, match[0].length), side: null, round: null });
    if (findings.length >= MAX_FINDINGS + 1) break;
  }
  return { flagged: findings.length > 0, findings };
}
