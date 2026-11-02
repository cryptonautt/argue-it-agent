/**
 * @handle mentions in comments. Pure functions (no server imports) — the comment renderer uses
 * `tokenizeMentions` on the client too.
 *
 * A mention is "@" + a handle (3–20 of [A-Za-z0-9_], matched case-insensitively, stored lowercase), not
 * preceded by a word character or another "@" (so emails like ada@example.com are not mentions).
 */

export const MAX_MENTIONS_PER_COMMENT = 10;

const MENTION_SOURCE = String.raw`(?<![A-Za-z0-9_@])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])`;

/** Distinct lowercase handles mentioned in `text`, in order of first appearance, capped at 10. */
export function extractMentionHandles(text: string, max = MAX_MENTIONS_PER_COMMENT): string[] {
  const handles: string[] = [];
  for (const match of text.matchAll(new RegExp(MENTION_SOURCE, "g"))) {
    const handle = match[1]?.toLowerCase();
    if (handle && !handles.includes(handle)) handles.push(handle);
    if (handles.length >= max) break;
  }
  return handles;
}

/** True when `text` mentions `handle` (case-insensitive). */
export function mentionsHandle(text: string, handle: string): boolean {
  return extractMentionHandles(text, Number.POSITIVE_INFINITY).includes(handle.toLowerCase());
}

/**
 * Replying to a reply attaches to the top-level comment (one level of nesting, design §4.1), so the
 * person being answered is named explicitly: prefix "@handle " unless the text already mentions them.
 */
export function withLeadingMention(text: string, handle: string): string {
  return mentionsHandle(text, handle) ? text : `@${handle.toLowerCase()} ${text}`;
}

export type MentionToken = { kind: "text"; text: string } | { kind: "mention"; text: string; handle: string };

/** Split text into plain-text and mention tokens for rendering (`@handle` becomes a profile link). */
export function tokenizeMentions(text: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(MENTION_SOURCE, "g"))) {
    const start = match.index;
    const handle = match[1];
    if (handle === undefined) continue;
    if (start > last) tokens.push({ kind: "text", text: text.slice(last, start) });
    tokens.push({ kind: "mention", text: match[0], handle: handle.toLowerCase() });
    last = start + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}
