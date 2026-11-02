/**
 * Judge configuration constants (design §4.3). Every fairness threshold lives here so it is reviewable in
 * one place, cited by tests, and shown on /rules. Changing a value changes how verdicts are decided —
 * bump PROMPT_VERSION / rubric versions where the change affects what the judge is asked to do.
 */

/** Model used for real judging passes (design §3). */
export const JUDGE_MODEL = "claude-opus-5-5";
/** Model id recorded for passes produced by the deterministic offline mock. */
export const MOCK_JUDGE_MODEL = "mock-judge-v1";

/** Weighted totals are on a 0–100 scale. */
export const MAX_TOTAL = 100;
/** Per-criterion scores are 0–10. */
export const MAX_CRITERION_SCORE = 10;

/** Both passes must agree AND each must have at least this confidence for a decided winner (§4.3.3). */
export const MIN_DECISION_CONFIDENCE = 0.6;
/** Averaged margin below this fraction of MAX_TOTAL → draw (§4.3.3: "< 3% of max"). */
export const DRAW_MARGIN_FRACTION = 0.03;
/** Same threshold in total points (3 of 100). */
export const DRAW_MARGIN_POINTS = DRAW_MARGIN_FRACTION * MAX_TOTAL;
/**
 * A single pass whose weighted totals are closer than this calls a draw for that pass. The pass's own
 * rubric scores — the bars users see — decide its winner, so a verdict never contradicts its score bars.
 */
export const PASS_TIE_MARGIN_POINTS = DRAW_MARGIN_POINTS;

/** Confidence lost per quote the judge claimed but which is not verbatim in the side's text (§4.3.2). */
export const INVALID_QUOTE_CONFIDENCE_PENALTY = 0.05;
/** Cap on the total invalid-quote penalty for one pass. */
export const MAX_INVALID_QUOTE_PENALTY = 0.3;
/**
 * If the judge's stated winner disagrees with the winner implied by its own rubric scores, the pass is
 * internally inconsistent: its confidence is multiplied by this factor (making a human review likelier).
 */
export const INCOHERENT_WINNER_CONFIDENCE_FACTOR = 0.5;
/** Each criterion carries 1–3 supporting quotes; extras are dropped (not counted as invalid). */
export const MAX_QUOTES_PER_CRITERION = 3;

/** Confidence label boundaries for "High / Medium / Low" (§4.3.8). */
export const HIGH_CONFIDENCE_MIN = 0.8;
export const MEDIUM_CONFIDENCE_MIN = MIN_DECISION_CONFIDENCE;

// --- Job queue ---------------------------------------------------------------------------------------

/** Attempts per evaluation job before it fails to `needs_review` (§4.3.7). */
export const MAX_JOB_ATTEMPTS = 3;
/** Backoff before retry n (1-based): base × 4^(n-1) → 1 min, 4 min. */
export const JOB_RETRY_BASE_MS = 60_000;
/** A `running` job whose claim is older than this is considered abandoned and may be reclaimed. */
export const JOB_LEASE_MS = 20 * 60_000;
/** Default number of jobs one `processEvaluationJobs()` call handles (each job is 2–4 model calls). */
export const DEFAULT_JOBS_PER_TICK = 2;

// --- Anthropic request shape -------------------------------------------------------------------------

/** Room for adaptive thinking plus the structured verdict JSON. Streamed, so no HTTP timeout risk. */
export const JUDGE_MAX_TOKENS = 32_000;
/** Per-request timeout for one judging pass. */
export const JUDGE_REQUEST_TIMEOUT_MS = 10 * 60_000;
/** SDK-level retries for transient errors inside one pass (the job queue retries on top of this). */
export const JUDGE_SDK_MAX_RETRIES = 2;
/** Server-side refusal fallback (design §3). */
export const JUDGE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

// --- Provider selection & framework engine (Agent-Native port, plan Task 4) ---------------------------

/**
 * `JUDGE_PROVIDER` is REQUIRED: `engine` (the framework's configured LLM engine via resolveEngine()),
 * `anthropic` (direct Anthropic SDK with a deployment-level ANTHROPIC_API_KEY) or `mock` (deterministic
 * offline heuristic; tests and local fairness runs only, never when NODE_ENV=production).
 * There is no default and no inference: unset means judging fails into the retry → needs_review path.
 */
export const JUDGE_PROVIDER_KINDS = ["engine", "anthropic", "mock"] as const;
/** Error message every "no usable judge" failure starts with (the job queue records it as lastError). */
export const JUDGE_PROVIDER_UNAVAILABLE = "judge provider unavailable";
/** Optional model override for the engine provider (otherwise the app's stored model, then the engine default). */
export const JUDGE_ENGINE_MODEL_ENV = "JUDGE_MODEL";
/** appId passed to resolveEngine() so the judge sees the same engine/model settings as the chat agent. */
export const JUDGE_ENGINE_APP_ID = "argue-it";
/** Model id reported by the engine provider before any engine has been resolved. */
export const ENGINE_UNRESOLVED_MODEL = "engine-unresolved";

// --- Background tick ---------------------------------------------------------------------------------

/** How often the in-process background tick runs (deadlines, judging, housekeeping). */
export const TICK_INTERVAL_MS = 60_000;
/** Delay before the first tick after server start, so migrations and plugins finish first. */
export const TICK_STARTUP_DELAY_MS = 10_000;
/** A tick may run up to DEFAULT_JOBS_PER_TICK jobs × 4 passes; report (not abort) a tick slower than this. */
export const TICK_TIMEOUT_MS = 30 * 60_000;
