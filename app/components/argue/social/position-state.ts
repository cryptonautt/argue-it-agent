/** Pure helpers for the free-position bar (optimistic counts + announcements). Client-safe. */
import type { PositionSide } from "@domain/db/schema";
import type { PositionSummary } from "@domain/social/types";

/** The summary after the viewer moves to `next` (null = remove), assuming nobody else changed theirs. */
export function applyPositionChange(summary: PositionSummary, next: PositionSide | null): PositionSummary {
  const current = summary.viewerSide;
  if (current === next) return summary;
  let { agree, against } = summary;
  if (current === "AGREE") agree = Math.max(0, agree - 1);
  if (current === "AGAINST") against = Math.max(0, against - 1);
  if (next === "AGREE") agree += 1;
  if (next === "AGAINST") against += 1;
  return { ...summary, agree, against, viewerSide: next };
}

const nf = new Intl.NumberFormat("en-GB");

export function formatCount(n: number): string {
  return nf.format(n);
}

/** Screen-reader sentence after a change, e.g. "Your position: AGREE. 13 agree, 5 against." */
export function describePosition(summary: PositionSummary): string {
  const mine = summary.viewerSide ? `Your position: ${summary.viewerSide}.` : "You have no position.";
  return `${mine} ${formatCount(summary.agree)} agree, ${formatCount(summary.against)} against.`;
}

/** Window event so other widgets on the page (the comment composer's position tag) stay in sync. */
export const POSITION_EVENT = "argueit:position-change";

export interface PositionEventDetail {
  argumentId: string;
  side: PositionSide | null;
}
