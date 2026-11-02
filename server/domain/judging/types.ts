/**
 * Public types of the AI judge (design §4.3). Owner: judge team. The fairness team tests against these,
 * so changes must stay backward compatible (add optional fields; don't rename).
 *
 * Canonical labels: Side A = FOR the proposition, Side B = AGAINST. Every PassOutput is expressed in
 * canonical labels, even for a BA-order pass (the pipeline maps presentation labels back).
 */
import type {
  ClaimClassification,
  InjectionFinding,
  RubricCriterion,
  SideLabel,
  TokenUsage,
  VerdictExplanation,
  VerdictScores,
} from "@domain/db/json-types";
import type { VerdictOutcome } from "@domain/db/schema";

export type { ClaimClassification, InjectionFinding, RubricCriterion, SideLabel, TokenUsage, VerdictExplanation, VerdictScores };

export type PassOrder = "AB" | "BA";
export type PassWinner = SideLabel | "draw";

/** A versioned rubric (lives in code under src/server/judging/rubrics/, mirrored to the `rubrics` table). */
export interface RubricDef {
  id: string;
  version: number;
  name: string;
  /** Plain-language description shown on /rules and in the terms preview. */
  description: string;
  categorySlugs: string[];
  /** Weights sum to 100. */
  criteria: RubricCriterion[];
}

// ---------------------------------------------------------------------------
// Blind case file
// ---------------------------------------------------------------------------

export interface CaseSubmission {
  /** Frozen submission text with participant identities redacted. */
  text: string;
  /** Evidence link URLs (not fetched in v1). */
  links: string[];
}

export interface CaseSide {
  label: SideLabel;
  stance: "FOR" | "AGAINST";
  /** Null = no submission for that round (a missing rebuttal is allowed and scores lower on rebuttal). */
  opening: CaseSubmission | null;
  rebuttal: CaseSubmission | null;
}

/**
 * Everything the judge may see — and nothing else (design §4.3.1). No user ids, names, handles,
 * avatars, follower counts, reactions, position counts, ratings, or who challenged whom.
 */
export interface CaseFile {
  schemaVersion: 1;
  proposition: string;
  category: { slug: string; name: string };
  rubric: { id: string; version: number };
  sides: { A: CaseSide; B: CaseSide };
}

export interface BuiltCaseFile {
  caseFile: CaseFile;
  /** sha256 hex of the canonical JSON of `caseFile`. */
  caseHash: string;
  /** Prompt-injection heuristics that matched (recorded; never helps a side). */
  injectionFindings: InjectionFinding[];
  /** Number of identity redactions applied across all submissions. */
  redactionCount: number;
}

// ---------------------------------------------------------------------------
// Redaction / injection / quotes
// ---------------------------------------------------------------------------

export type RedactionLabel = "[Side A]" | "[Side B]" | "[participant]";

export interface RedactionTarget {
  /** A handle (with or without "@") or display name to remove. Matched case-insensitively on word boundaries. */
  term: string;
  replacement: RedactionLabel;
}

export interface RedactionResult {
  text: string;
  redactions: number;
}

export interface InjectionScanResult {
  flagged: boolean;
  /** Findings with `side`/`round` null — the caller fills them in. */
  findings: InjectionFinding[];
}

export interface QuoteValidation {
  /** Quotes that are substrings of the source (after whitespace normalisation), in input order. */
  valid: string[];
  invalid: string[];
}

// ---------------------------------------------------------------------------
// Passes & comparison
// ---------------------------------------------------------------------------

export interface CriterionScore {
  /** 0–10 */
  score: number;
  /** One sentence. */
  reason: string;
  /** 1–3 verbatim quotes from THIS side's text (validated; invalid ones removed). */
  quotes: string[];
}

export interface ClaimAssessment {
  claim: string;
  classification: ClaimClassification;
}

export interface SidePassResult {
  /** Keyed by rubric criterion key. Every rubric criterion must be present. */
  criteria: Record<string, CriterionScore>;
  claims: ClaimAssessment[];
  strengths: string[];
  weaknesses: string[];
}

/** One independent judging pass, in canonical labels. */
export interface PassOutput {
  passNo: number;
  order: PassOrder;
  sides: { A: SidePassResult; B: SidePassResult };
  winner: PassWinner;
  /** Model-reported margin, 0–100 scale of the weighted total. */
  margin: number;
  /** 0–1, after any reduction for invalid quotes. */
  confidence: number;
  /** Short neutral rationale for the overall call. */
  rationale: string;
  /** Quotes dropped by validateQuotes() during this pass. */
  invalidQuoteCount: number;
  /**
   * The winner the judge itself stated (canonical labels). `winner` is derived from the pass's own weighted
   * rubric totals; when the two disagree the pass is incoherent and its confidence was reduced.
   */
  statedWinner?: PassWinner;
}

export interface PassTotals {
  passNo: number;
  order: PassOrder;
  /** Weighted totals on a 0–100 scale. */
  A: number;
  B: number;
  winner: PassWinner;
  confidence: number;
}

/** Result of comparing the passes so far (design §4.3.3). */
export type ComparisonResult =
  | { kind: "decided"; outcome: "A" | "B" | "draw"; confidence: number; totals: PassTotals[]; reason: string }
  | { kind: "needs_another_pass"; totals: PassTotals[]; reason: string }
  | { kind: "inconclusive"; confidence: number; totals: PassTotals[]; reason: string };

/** The verdict the pipeline is about to write (matches the `verdicts` table JSON columns). */
export interface VerdictDraft {
  outcome: Exclude<VerdictOutcome, "forfeit">;
  confidence: number;
  scores: VerdictScores;
  explanation: VerdictExplanation;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface JudgePassInput {
  caseFile: CaseFile;
  rubric: RubricDef;
  passNo: number;
  /** AB = Side A presented first. The provider relabels for BA and maps back to canonical labels. */
  order: PassOrder;
  promptVersion: string;
}

export type JudgePassResult =
  | {
      ok: true;
      output: PassOutput;
      /** The raw structured output exactly as returned (stored for audit). */
      raw: unknown;
      usage: TokenUsage | null;
      latencyMs: number;
      stopReason: string | null;
      /** Model that actually produced the output (differs from `provider.model` after a server-side fallback). */
      servedModel?: string;
    }
  | {
      ok: false;
      kind: "refusal" | "provider_error" | "invalid_output" | "timeout";
      error: string;
      raw?: unknown;
      usage?: TokenUsage | null;
      latencyMs: number;
      stopReason?: string | null;
      servedModel?: string;
      /** Whether retrying the job may help (provider errors) or not (refusals count as failed passes). */
      retryable: boolean;
    };

/** Implemented by the Anthropic provider and the deterministic mock (JUDGE_PROVIDER=mock). */
export interface JudgeProvider {
  /** "anthropic" | "mock" */
  readonly id: string;
  /** Model id recorded on each pass, e.g. "claude-opus-5-5" or "mock-v1". */
  readonly model: string;
  runPass(input: JudgePassInput): Promise<JudgePassResult>;
}

export interface RunEvaluationResult {
  status: "completed" | "needs_review";
  verdictId: string | null;
  runId: string;
}
