import { describe, expect, it } from "vitest";
import {
  ACCEPT_WINDOW_HOURS,
  OPENING_MAX_CHARS,
  REBUTTAL_MAX_CHARS,
  RULES_TEXT,
  buildRulesSnapshot,
  canonicalJson,
  roundCharLimit,
  termsFingerprint,
} from "./terms";
import { hashTerms, hashesEqual } from "./terms-hash";
import { isRoundRevealed, submissionVisibility } from "./visibility";

const input = {
  proposition: "  Messi is better than Ronaldo.  ",
  argumentId: "a",
  sourceCommentId: null,
  category: { id: "c", slug: "sports", name: "Sports & Football" },
  rubric: { id: "sports", version: 1 },
  challengerId: "u1",
  recipientId: "u2",
  challengerSide: "AGAINST" as const,
  roundDurationHours: 48 as const,
  sentAt: new Date("2026-11-01T12:00:00.000Z"),
};

describe("buildRulesSnapshot", () => {
  it("freezes the full terms with the recipient on the other side", () => {
    const snapshot = buildRulesSnapshot(input);
    expect(snapshot).toMatchObject({
      snapshotVersion: 1,
      format: "direct_v1",
      proposition: "Messi is better than Ronaldo.",
      challengerSide: "AGAINST",
      recipientSide: "FOR",
      roundDurationHours: 48,
      acceptWindowHours: ACCEPT_WINDOW_HOURS,
      limits: { openingMaxChars: OPENING_MAX_CHARS, rebuttalMaxChars: REBUTTAL_MAX_CHARS, maxLinksPerSubmission: 5 },
      rulesText: RULES_TEXT,
      sentAt: "2026-11-01T12:00:00.000Z",
    });
    expect(roundCharLimit(snapshot, "opening")).toBe(4000);
    expect(roundCharLimit(snapshot, "rebuttal")).toBe(2500);
  });
});

describe("canonical JSON and terms hash", () => {
  it("is independent of key order (JSONB does not keep it)", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });

  it("hashes the same snapshot identically after a JSON round trip, and changes on any edit", () => {
    const snapshot = buildRulesSnapshot(input);
    const hash = hashTerms(snapshot);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const roundTripped = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(hashTerms(roundTripped)).toBe(hash);
    expect(hashTerms({ ...snapshot, roundDurationHours: 24 })).not.toBe(hash);
    expect(hashTerms({ ...snapshot, proposition: "Messi is better than Ronaldo!" })).not.toBe(hash);
    expect(hashesEqual(hash, hash)).toBe(true);
    const tampered = `${hash[0] === "a" ? "b" : "a"}${hash.slice(1)}`;
    expect(hashesEqual(hash, tampered)).toBe(false);
    expect(hashesEqual(hash, "short")).toBe(false);
    expect(termsFingerprint(hash)).toMatch(/^[0-9A-F]{4} [0-9A-F]{4}$/);
  });
});

describe("sealed visibility", () => {
  const opening = { status: "active" as const, round: "opening" as const, lockedAt: null };
  const rebuttal = { status: "active" as const, round: "rebuttal" as const, lockedAt: null };
  const locked = { status: "locked" as const, round: null, lockedAt: new Date() };

  it("keeps openings sealed until the opening round closes", () => {
    expect(isRoundRevealed({ status: "pending_acceptance", round: null, lockedAt: null }, "opening")).toBe(false);
    expect(isRoundRevealed(opening, "opening")).toBe(false);
    expect(isRoundRevealed(rebuttal, "opening")).toBe(true);
    expect(isRoundRevealed(locked, "opening")).toBe(true);
  });

  it("keeps rebuttals sealed until the rebuttal round closes", () => {
    expect(isRoundRevealed(rebuttal, "rebuttal")).toBe(false);
    expect(isRoundRevealed(locked, "rebuttal")).toBe(true);
    expect(isRoundRevealed({ status: "completed", round: null, lockedAt: "2026-11-01T00:00:00Z" }, "rebuttal")).toBe(true);
  });

  it("a round that never closed stays sealed after cancellation", () => {
    expect(isRoundRevealed({ status: "cancelled", round: "opening", lockedAt: null }, "opening")).toBe(false);
    expect(isRoundRevealed({ status: "cancelled", round: "rebuttal", lockedAt: null }, "opening")).toBe(true);
    expect(isRoundRevealed({ status: "cancelled", round: "rebuttal", lockedAt: null }, "rebuttal")).toBe(false);
  });

  it("authors always see their own; others see sealed / moderated placeholders", () => {
    const base = { state: opening, round: "opening" as const, submissionStatus: "visible" as const };
    expect(submissionVisibility({ ...base, viewerIsAuthor: true })).toBe("visible");
    expect(submissionVisibility({ ...base, viewerIsAuthor: false })).toBe("sealed");
    expect(submissionVisibility({ ...base, state: rebuttal, viewerIsAuthor: false })).toBe("visible");
    expect(
      submissionVisibility({ ...base, state: rebuttal, viewerIsAuthor: false, submissionStatus: "hidden" }),
    ).toBe("moderated");
    expect(submissionVisibility({ ...base, state: rebuttal, viewerIsAuthor: true, submissionStatus: "removed" })).toBe(
      "visible",
    );
  });
});
