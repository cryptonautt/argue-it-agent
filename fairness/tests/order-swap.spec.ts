/**
 * Order-swap mapping (design §4.3.2): Pass 2 shows B first under neutral position labels and is mapped
 * back to canonical A/B. A mistake here would silently hand one side's scores or quotes to the other.
 * Owner: fairness.
 *
 * The fake judges below answer in PRESENTATION labels (X = shown first) and go through the judge's real
 * `finalizePass`, exactly like the Anthropic provider.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PROMPT_VERSION, type JudgeProvider } from "@domain/judging";
import { canonicaliseQuote, presentCase, relabelRedactionTokens } from "@domain/judging/presentation";
import type { PreparedCase } from "../lib/case-source";
import { loadCases } from "../lib/load-cases";
import { computeMetrics } from "../lib/metrics";
import { auditQuotes, runCase } from "../lib/run-case";
import { prepareCases } from "../lib/suite";
import { presentationProvider } from "./helpers";

const SAMPLE_IDS = [
  "clear-messi-ballon-dor",
  "identity-opponent-handle-coding",
  "style-penalties-pidgin",
  "length-short-sharp-vs-padded",
  "missing-rebuttal-gaming-career",
];

let prepared: PreparedCase[] = [];
beforeAll(async () => {
  prepared = await prepareCases(loadCases().filter((c) => SAMPLE_IDS.includes(c.id)));
}, 60_000);

const byId = (id: string) => {
  const p = prepared.find((x) => x.fairnessCase.id === id);
  if (!p) throw new Error(`prepared case ${id} missing`);
  return p;
};
const run = (p: PreparedCase, provider: JudgeProvider) => runCase(p, { provider, promptVersion: PROMPT_VERSION });

/** Judges by substance only: the FOR side's text always earns 8, AGAINST 3, wherever it is shown. */
const stanceJudge = presentationProvider((x, y) => ({
  x: x.stance === "FOR" ? 8 : 3,
  y: y.stance === "FOR" ? 8 : 3,
  confidence: 0.9,
}));
/** Pure first-position bias: whoever is shown first wins. */
const firstPositionJudge = presentationProvider(() => ({ x: 8, y: 3, confidence: 0.9 }));

describe("presentCase", () => {
  it("shows A first in AB and B first in BA, under neutral X/Y labels that map back", () => {
    for (const p of prepared) {
      const ab = presentCase(p.built.caseFile, "AB");
      const ba = presentCase(p.built.caseFile, "BA");
      expect(ab.sides.map((s) => [s.label, s.canonical])).toEqual([
        ["X", "A"],
        ["Y", "B"],
      ]);
      expect(ba.sides.map((s) => [s.label, s.canonical])).toEqual([
        ["X", "B"],
        ["Y", "A"],
      ]);
      expect(ab.toCanonical).toEqual({ X: "A", Y: "B" });
      expect(ba.toCanonical).toEqual({ X: "B", Y: "A" });
    }
  });

  it("never shows the canonical redaction labels, so 'A'/'B' cannot leak which side is FOR", () => {
    const p = byId("identity-opponent-handle-coding");
    for (const order of ["AB", "BA"] as const) {
      const presented = JSON.stringify(presentCase(p.built.caseFile, order).sides.map((s) => [s.opening, s.rebuttal]));
      expect(presented).not.toMatch(/\[Side [AB]\]/u);
    }
    // In BA, Side A is shown second, so its redaction token becomes [Side Y].
    const ba = presentCase(p.built.caseFile, "BA");
    expect(ba.sides[0].opening?.text).toContain("Don't listen to [Side Y].");
  });

  it("relabelling redaction tokens and mapping quotes back are exact inverses", () => {
    const text = "[Side A] said [Side B] was wrong, and [Side A] repeated it.";
    for (const [toPresentation, toCanonical] of [
      [{ A: "X", B: "Y" }, { X: "A", Y: "B" }],
      [{ A: "Y", B: "X" }, { X: "B", Y: "A" }],
    ] as const) {
      expect(canonicaliseQuote(relabelRedactionTokens(text, toPresentation), toCanonical)).toBe(text);
    }
  });

  it("presents the same words in both orders (only the order and labels change)", () => {
    for (const p of prepared) {
      const ab = presentCase(p.built.caseFile, "AB");
      const ba = presentCase(p.built.caseFile, "BA");
      const strip = (s: string | undefined) => s?.replace(/\[Side [XY]\]/gu, "[Side ?]");
      for (const canonical of ["A", "B"] as const) {
        const inAb = ab.sides.find((s) => s.canonical === canonical);
        const inBa = ba.sides.find((s) => s.canonical === canonical);
        expect(strip(inBa?.opening?.text)).toBe(strip(inAb?.opening?.text));
        expect(strip(inBa?.rebuttal?.text)).toBe(strip(inAb?.rebuttal?.text));
        expect(inBa?.stance).toBe(inAb?.stance);
      }
    }
  });
});

describe("order-swap mapping through finalizePass", () => {
  it("a judge that scores substance gives the same canonical winner in both orders", async () => {
    for (const p of prepared) {
      const r = await run(p, stanceJudge);
      expect(r.passes.map((x) => [x.order, x.winner])).toEqual([
        ["AB", "A"],
        ["BA", "A"],
      ]);
      expect(r.outcome).toBe("A");
      expect(r.passes[0]?.totals).toEqual(r.passes[1]?.totals);
    }
  });

  it("every quote lands on the side that wrote it, in both orders", async () => {
    for (const p of prepared) {
      const r = await run(p, stanceJudge);
      for (const pass of r.passes) {
        expect(pass.quoteAudit?.checked).toBeGreaterThan(0);
        expect(pass.quoteAudit?.misattributed).toEqual([]);
        expect(pass.quoteAudit?.fabricated).toEqual([]);
      }
    }
  });

  it("a mapping bug (BA output not mapped back) is caught by the quote audit and the swap metric", async () => {
    const broken: JudgeProvider = {
      id: "broken",
      model: "broken",
      async runPass(input) {
        const result = await stanceJudge.runPass(input);
        if (!result.ok || input.order === "AB") return result;
        const o = result.output;
        return { ...result, output: { ...o, sides: { A: o.sides.B, B: o.sides.A }, winner: o.winner === "A" ? "B" : o.winner === "B" ? "A" : "draw" } };
      },
    };
    const runs = await Promise.all(prepared.map((p) => run(p, broken)));
    const metrics = computeMetrics(runs);
    expect(metrics.positionConsistency.value).toBe(0);
    expect(metrics.quotes.misattributed).toBeGreaterThan(0);
    // The audit itself, directly on one BA pass.
    const p = byId("clear-messi-ballon-dor");
    const ba = await broken.runPass({ caseFile: p.built.caseFile, rubric: p.rubric, passNo: 2, order: "BA", promptVersion: PROMPT_VERSION });
    if (!ba.ok) throw new Error("fake pass failed");
    expect(auditQuotes(ba.output, p.built.caseFile).misattributed.length).toBeGreaterThan(0);
  });

  it("a purely first-position-biased judge is exposed and can never decide a split debate", async () => {
    const runs = await Promise.all(prepared.map((p) => run(p, firstPositionJudge)));
    const metrics = computeMetrics(runs);
    expect(metrics.positionConsistency.value).toBe(0);
    for (const r of runs) {
      expect(r.passes.map((x) => x.winner)).toEqual(["A", "B", "A", "B"]);
    }
    // The extra pair is order-balanced (Pass 3 A-first, Pass 4 B-first; design §4.3.3, revised 2026-10-31),
    // so pure first-position bias splits 2–2 and every case goes to a human instead of to Side A (FOR).
    expect(metrics.tiebreaks.extraPassesSidedWithFirstShown.value).toBe(1);
    expect(runs.every((r) => r.outcome === "inconclusive")).toBe(true);
  });
});
