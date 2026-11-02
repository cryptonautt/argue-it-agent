/**
 * The fairness case suite itself is valid and covers what the founder asked for. Owner: fairness.
 * If one of these fails, the suite is broken — fix the cases, never the expectation.
 */
import { describe, expect, it } from "vitest";
import { CASE_TAGS, CATEGORY_SLUGS, STYLE_VARIANTS, type CaseTag, type FairnessCase } from "../lib/case-schema";
import { loadCases } from "../lib/load-cases";

const cases = loadCases();
const tagged = (tag: CaseTag) => cases.filter((c) => c.tags.includes(tag));

describe("fairness case suite", () => {
  it("has at least 24 valid cases with unique ids", () => {
    expect(cases.length).toBeGreaterThanOrEqual(24);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("covers every launch category", () => {
    for (const slug of CATEGORY_SLUGS) expect(cases.filter((c) => c.category === slug).length, slug).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["clear", 10],
    ["even", 3],
    ["ambiguous", 1],
    ["subjective", 3],
    ["draw", 1],
    ["fabricated_source", 2],
    ["fake_statistics", 2],
    ["contradiction", 1],
    ["injection", 5],
    ["identity_bait", 3],
    ["length_bias", 2],
    ["cross_style", 2],
    ["missing_rebuttal", 1],
    ["pidgin", 6],
  ] as const)("tag %s has at least %i cases", (tag, min) => {
    expect(tagged(tag).length).toBeGreaterThanOrEqual(min);
  });

  it("covers every injection technique the founder listed", () => {
    const techniques = new Set(tagged("injection").map((c) => c.injection?.technique));
    for (const t of ["direct", "hidden", "role_play", "judge_decided"]) expect(techniques).toContain(t);
  });

  it("covers own-handle/follower, famous-claim and opponent-handle identity bait", () => {
    const techniques = new Set(tagged("identity_bait").map((c) => c.identityBait?.technique));
    expect(techniques).toContain("famous_claim");
    expect(techniques).toContain("opponent_handle");
    expect(techniques.has("own_handle") || techniques.has("follower_count")).toBe(true);
  });

  it("tests length bias in both directions (short can win, long can win)", () => {
    const length = tagged("length_bias");
    const longer = (c: FairnessCase, side: "A" | "B") =>
      (c.sides[side].opening.text + (c.sides[side].rebuttal?.text ?? "")).length;
    const winnerIsShorter = length.filter((c) => {
      if (c.expected !== "A" && c.expected !== "B") return false;
      const loser = c.expected === "A" ? "B" : "A";
      return longer(c, c.expected) < longer(c, loser);
    });
    expect(winnerIsShorter.length).toBeGreaterThanOrEqual(1);
    expect(length.length - winnerIsShorter.length).toBeGreaterThanOrEqual(1);
  });

  it("expects both sides to win somewhere (the suite itself is not biased toward FOR or AGAINST)", () => {
    const a = cases.filter((c) => c.expected === "A").length;
    const b = cases.filter((c) => c.expected === "B").length;
    expect(Math.min(a, b) / Math.max(a, b)).toBeGreaterThan(0.6);
  });
});

describe("style variant groups", () => {
  const groups = new Map<string, FairnessCase[]>();
  for (const c of tagged("style_variant")) {
    const group = c.style?.group ?? "";
    groups.set(group, [...(groups.get(group) ?? []), c]);
  }

  it("has at least 6 groups", () => {
    expect(groups.size).toBeGreaterThanOrEqual(6);
  });

  it.each([...groups.entries()])("group %s has formal, casual and Pidgin variants of the same debate", (_group, variants) => {
    expect(variants.map((v) => v.style?.variant).sort()).toEqual([...STYLE_VARIANTS].sort());
    const [first, ...rest] = variants as [FairnessCase, ...FairnessCase[]];
    for (const v of rest) {
      expect(v.proposition).toBe(first.proposition);
      expect(v.category).toBe(first.category);
      expect(v.expected).toBe(first.expected);
      expect(v.participants).toEqual(first.participants);
      // Same structure: a variant may not add or drop a round.
      for (const side of ["A", "B"] as const) expect(v.sides[side].rebuttal === null).toBe(first.sides[side].rebuttal === null);
    }
    expect(variants.find((v) => v.style?.variant === "pidgin")?.tags).toContain("pidgin");
  });

  it("variants carry a clear expected winner, so invariance is about style and not noise", () => {
    for (const c of tagged("style_variant")) expect(["A", "B"]).toContain(c.expected);
  });
});

describe("case hygiene", () => {
  it("only uses known tags", () => {
    for (const c of cases) for (const t of c.tags) expect(CASE_TAGS).toContain(t);
  });

  it("does not mention participant identities except in identity-bait cases", () => {
    for (const c of cases) {
      if (c.identityBait) continue;
      const text = JSON.stringify(c.sides).toLocaleLowerCase();
      for (const p of [c.participants.A, c.participants.B]) {
        expect(text, `${c.id} mentions @${p.handle}`).not.toContain(p.handle);
        expect(text, `${c.id} mentions ${p.displayName}`).not.toContain(p.displayName.toLocaleLowerCase());
      }
    }
  });

  it("identity-bait cases really do mention a participant handle or name (or claim status)", () => {
    for (const c of tagged("identity_bait")) {
      const bait = c.identityBait;
      if (!bait) throw new Error("schema guarantees identityBait");
      const text = JSON.stringify(c.sides[bait.side]);
      if (bait.technique === "famous_claim") expect(text.toLocaleLowerCase()).toMatch(/famous|insider|tv/u);
      else {
        const target = bait.technique === "opponent_handle" ? c.participants[bait.side === "A" ? "B" : "A"] : c.participants[bait.side];
        expect(text).toContain(`@${target.handle}`);
      }
    }
  });
});
