/**
 * Link safety (design §4.7): http(s) only (javascript:, data:, file:… rejected), at most 5 links,
 * ≤ 2,048 chars each, no embedded credentials. Use `linksSchema` in zod inputs and `LINK_REL` on
 * every rendered user link: <a href={url} rel={LINK_REL} target="_blank">.
 */
import { z } from "zod";

export const MAX_LINKS = 5;
export const MAX_LINK_LENGTH = 2048;
/** rel attribute for every user-supplied link. */
export const LINK_REL = "nofollow ugc noopener noreferrer";

export type LinkValidation = { ok: true; url: string } | { ok: false; error: string };

/** Validate and normalise one URL. Returns the normalised href. */
export function validateLink(raw: string): LinkValidation {
  const input = raw.trim();
  if (input.length === 0) return { ok: false, error: "Link is empty." };
  if (input.length > MAX_LINK_LENGTH) return { ok: false, error: "Link is too long." };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "Enter a full link starting with https:// or http://." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http:// and https:// links are allowed." };
  }
  if (!url.hostname || !url.hostname.includes(".")) {
    return { ok: false, error: "That link has no valid website address." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Links with a username or password in them are not allowed." };
  }
  return { ok: true, url: url.href };
}

export function isSafeLink(raw: string): boolean {
  return validateLink(raw).ok;
}

export type LinksValidation = { ok: true; links: string[] } | { ok: false; error: string; index?: number };

/** Validate a list of links: drops blanks, de-duplicates, enforces `max` (default MAX_LINKS). */
export function validateLinks(raw: readonly string[], max: number = MAX_LINKS): LinksValidation {
  const out: string[] = [];
  for (const [index, value] of raw.entries()) {
    if (value.trim().length === 0) continue;
    const result = validateLink(value);
    if (!result.ok) return { ok: false, error: result.error, index };
    if (!out.includes(result.url)) out.push(result.url);
  }
  if (out.length > max) return { ok: false, error: `Add at most ${max} links.` };
  return { ok: true, links: out };
}

/** Split a textarea value (one link per line, or comma/space separated) into raw links. */
export function parseLinkList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** zod schema: string[] → validated, normalised, de-duplicated string[] (max 5). */
export const linksSchema = z
  .array(z.string())
  .default([])
  .transform((links, ctx) => {
    const result = validateLinks(links);
    if (!result.ok) {
      ctx.addIssue({
        code: "custom",
        message: result.error,
        path: result.index === undefined ? [] : [result.index],
      });
      return z.NEVER;
    }
    return result.links;
  });

/** Short display form of a link: hostname + truncated path. */
export function displayLink(href: string, maxLength = 48): string {
  try {
    const url = new URL(href);
    const text = `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  } catch {
    return href.slice(0, maxLength);
  }
}
