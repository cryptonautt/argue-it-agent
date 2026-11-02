/**
 * Owner: verdict. Defensive readers for judge JSON stored as `unknown` (evaluation_passes.output,
 * evaluation_runs.comparison). The admin review screen shows passes side by side; it must never crash
 * on a malformed or older-shaped row, so everything here returns null instead of throwing. Pure.
 */
import type { SideLabel } from "@domain/db/json-types";

export interface PassCriterionView {
  key: string;
  A: number | null;
  B: number | null;
  reasonA: string | null;
  reasonB: string | null;
}

export interface PassOutputView {
  winner: SideLabel | "draw" | null;
  margin: number | null;
  confidence: number | null;
  rationale: string | null;
  criteria: PassCriterionView[];
}

export interface PassTotalsView {
  passNo: number;
  A: number;
  B: number;
  winner: SideLabel | "draw" | null;
  confidence: number | null;
}

export interface ComparisonView {
  kind: string | null;
  reason: string | null;
  totals: PassTotalsView[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const winnerOf = (v: unknown): SideLabel | "draw" | null => (v === "A" || v === "B" || v === "draw" ? v : null);

/**
 * Read a canonical-label PassOutput ({ sides: { A: { criteria }, B: { criteria } }, winner, … }), either bare
 * or wrapped as the judge's StoredPassOutput ({ raw, labels, pass }). Never reads `raw` — it is in the
 * pass's presentation labels, which would swap the sides for a BA pass.
 * Returns null if the shape isn't recognisable (the screen then falls back to the raw JSON).
 */
export function readPassOutput(stored: unknown): PassOutputView | null {
  // The judge stores { raw, labels, pass } where `pass` is the canonical PassOutput; accept a bare one too.
  const output = isObj(stored) && isObj(stored.pass) ? stored.pass : stored;
  if (!isObj(output) || !isObj(output.sides)) return null;
  const a = output.sides.A;
  const b = output.sides.B;
  if (!isObj(a) || !isObj(b) || !isObj(a.criteria) || !isObj(b.criteria)) return null;
  const critA = a.criteria;
  const critB = b.criteria;
  const keys = [...new Set([...Object.keys(critA), ...Object.keys(critB)])];
  const criteria = keys.map((key): PassCriterionView => {
    const ca = critA[key];
    const cb = critB[key];
    return {
      key,
      A: isObj(ca) ? num(ca.score) : null,
      B: isObj(cb) ? num(cb.score) : null,
      reasonA: isObj(ca) ? str(ca.reason) : null,
      reasonB: isObj(cb) ? str(cb.reason) : null,
    };
  });
  return {
    winner: winnerOf(output.winner),
    margin: num(output.margin),
    confidence: num(output.confidence),
    rationale: str(output.rationale),
    criteria,
  };
}

/** Read evaluation_runs.comparison (the judge's ComparisonResult). */
export function readComparison(comparison: unknown): ComparisonView | null {
  if (!isObj(comparison)) return null;
  const totals: PassTotalsView[] = [];
  if (Array.isArray(comparison.totals)) {
    for (const t of comparison.totals) {
      if (!isObj(t)) continue;
      const passNo = num(t.passNo);
      const A = num(t.A);
      const B = num(t.B);
      if (passNo === null || A === null || B === null) continue;
      totals.push({ passNo, A, B, winner: winnerOf(t.winner), confidence: num(t.confidence) });
    }
  }
  return { kind: str(comparison.kind), reason: str(comparison.reason), totals };
}
