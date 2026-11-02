/**
 * Runs one prepared case through the judging protocol (design §4.3.3). Owner: fairness.
 *
 * Pass 1 presents A first, Pass 2 presents B first, both through the real provider; `comparePasses`
 * (the judge's own function) decides, and if it asks for another pass a fresh order-balanced pair runs
 * (Pass 3 A-first + Pass 4 B-first), exactly like src/server/judging/evaluate.ts. The
 * result records everything the metrics need, plus an independent audit that every quote the pipeline
 * kept really is verbatim from the side it is attributed to (a BA mis-mapping would show up here).
 */
import type { InjectionFinding, TokenUsage } from "@domain/db/json-types";
import {
  comparePasses,
  validateQuotes,
  type CaseFile,
  type ComparisonResult,
  type JudgePassResult,
  type JudgeProvider,
  type PassOrder,
  type PassOutput,
  type PassWinner,
  type RubricDef,
} from "@domain/judging";
import type { ExpectedOutcome, FairnessCase } from "./case-schema";
import type { PreparedCase } from "./case-source";
import { checkIdentityLeaks } from "./identity";

export type CaseOutcome = "A" | "B" | "draw" | "inconclusive" | "error";

export interface QuoteAudit {
  /** Quotes checked across both sides and all criteria. */
  checked: number;
  /** Quotes found only in the OTHER side's text (wrong attribution, e.g. a BA mapping bug). */
  misattributed: string[];
  /** Quotes found in neither side's text (should have been dropped by the pipeline). */
  fabricated: string[];
}

export interface PassRecord {
  passNo: number;
  order: PassOrder;
  ok: boolean;
  winner: PassWinner | null;
  confidence: number | null;
  totals: { A: number; B: number } | null;
  invalidQuoteCount: number;
  usage: TokenUsage | null;
  latencyMs: number;
  error: string | null;
  quoteAudit: QuoteAudit | null;
}

export interface CaseRun {
  id: string;
  title: string;
  category: FairnessCase["category"];
  expected: ExpectedOutcome;
  tags: FairnessCase["tags"];
  style: FairnessCase["style"] | null;
  injection: FairnessCase["injection"] | null;
  identityBait: FairnessCase["identityBait"] | null;
  rubric: string;
  caseHash: string;
  redactionCount: number;
  injectionFindings: InjectionFinding[];
  identityLeaks: string[];
  partialNameMentions: string[];
  passes: PassRecord[];
  outcome: CaseOutcome;
  confidence: number | null;
  reason: string;
}

export interface RunCaseOptions {
  provider: JudgeProvider;
  promptVersion: string;
}

const emptyAudit = (): QuoteAudit => ({ checked: 0, misattributed: [], fabricated: [] });

function sideTexts(caseFile: CaseFile, side: "A" | "B"): string[] {
  const s = caseFile.sides[side];
  return [s.opening?.text, s.rebuttal?.text].filter((t): t is string => typeof t === "string" && t.length > 0);
}

const quotedIn = (quote: string, sources: readonly string[]) =>
  sources.some((source) => validateQuotes([quote], source).valid.length === 1);

/** Audit a finalised pass: every kept quote must be verbatim from the side it is attributed to. */
export function auditQuotes(pass: PassOutput, caseFile: CaseFile): QuoteAudit {
  const audit = emptyAudit();
  for (const side of ["A", "B"] as const) {
    const own = sideTexts(caseFile, side);
    const other = sideTexts(caseFile, side === "A" ? "B" : "A");
    for (const criterion of Object.values(pass.sides[side].criteria)) {
      for (const quote of criterion.quotes) {
        audit.checked += 1;
        if (quotedIn(quote, own)) continue;
        if (quotedIn(quote, other)) audit.misattributed.push(`${side}: ${quote}`);
        else audit.fabricated.push(`${side}: ${quote}`);
      }
    }
  }
  return audit;
}

function recordPass(passNo: number, order: PassOrder, result: JudgePassResult, caseFile: CaseFile, rubric: RubricDef): PassRecord {
  if (!result.ok) {
    return {
      passNo,
      order,
      ok: false,
      winner: null,
      confidence: null,
      totals: null,
      invalidQuoteCount: 0,
      usage: result.usage ?? null,
      latencyMs: result.latencyMs,
      error: `${result.kind}: ${result.error}`,
      quoteAudit: null,
    };
  }
  const [totals] = comparePasses([result.output], rubric).totals;
  return {
    passNo,
    order,
    ok: true,
    winner: result.output.winner,
    confidence: result.output.confidence,
    totals: totals ? { A: totals.A, B: totals.B } : null,
    invalidQuoteCount: result.output.invalidQuoteCount,
    usage: result.usage,
    latencyMs: result.latencyMs,
    error: null,
    quoteAudit: auditQuotes(result.output, caseFile),
  };
}

function outcomeOf(comparison: ComparisonResult): { outcome: CaseOutcome; confidence: number | null } {
  switch (comparison.kind) {
    case "decided":
      return { outcome: comparison.outcome, confidence: comparison.confidence };
    case "inconclusive":
      return { outcome: "inconclusive", confidence: comparison.confidence };
    case "needs_another_pass":
      // After four passes comparePasses must decide; treat anything else as inconclusive, never a winner.
      return { outcome: "inconclusive", confidence: null };
  }
}

export async function runCase(prepared: PreparedCase, options: RunCaseOptions): Promise<CaseRun> {
  const { fairnessCase: c, rubric, built } = prepared;
  const { caseFile } = built;
  const identity = checkIdentityLeaks(c, caseFile);
  const base = {
    id: c.id,
    title: c.title,
    category: c.category,
    expected: c.expected,
    tags: c.tags,
    style: c.style ?? null,
    injection: c.injection ?? null,
    identityBait: c.identityBait ?? null,
    rubric: `${rubric.id}@${rubric.version}`,
    caseHash: built.caseHash,
    redactionCount: built.redactionCount,
    injectionFindings: built.injectionFindings,
    identityLeaks: identity.leaks,
    partialNameMentions: identity.partialMentions,
  };

  // Providers report failures as results, but a thrown error must not abort the whole suite either.
  const runPass = async (passNo: number, order: PassOrder): Promise<JudgePassResult> => {
    const started = Date.now();
    try {
      return await options.provider.runPass({ caseFile, rubric, passNo, order, promptVersion: options.promptVersion });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, kind: "provider_error", error: message, latencyMs: Date.now() - started, retryable: true };
    }
  };

  const passes: PassRecord[] = [];
  const outputs: PassOutput[] = [];
  const fail = (reason: string): CaseRun => ({ ...base, passes, outcome: "error", confidence: null, reason });

  // Passes 1 and 2 are independent; run them concurrently.
  const [r1, r2] = await Promise.all([runPass(1, "AB"), runPass(2, "BA")]);
  for (const [passNo, order, result] of [[1, "AB", r1], [2, "BA", r2]] as const) {
    passes.push(recordPass(passNo, order, result, caseFile, rubric));
    if (result.ok) outputs.push(result.output);
  }
  if (outputs.length < 2) return fail(`judging pass failed: ${passes.find((p) => !p.ok)?.error ?? "unknown"}`);

  let comparison = comparePasses(outputs, rubric);
  if (comparison.kind === "needs_another_pass") {
    const [r3, r4] = await Promise.all([runPass(3, "AB"), runPass(4, "BA")]);
    for (const [passNo, order, result] of [[3, "AB", r3], [4, "BA", r4]] as const) {
      passes.push(recordPass(passNo, order, result, caseFile, rubric));
      if (!result.ok) return fail(`pass ${passNo} failed: ${result.kind}: ${result.error}`);
      outputs.push(result.output);
    }
    comparison = comparePasses(outputs, rubric);
  }
  return { ...base, passes, ...outcomeOf(comparison), reason: comparison.reason };
}

/** Run `fn` over `items` with at most `limit` in flight, preserving input order in the result. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
