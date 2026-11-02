/**
 * Owner: verdict. Appeal rules (design §4.4) as plain, client-safe constants. No server-only import:
 * the appeal form, /rules and the admin screens all render from this single source of truth.
 */
import type { AppealGround, AppealStatus } from "@domain/db/schema";

/** Either participant may appeal within this many hours of the verdict (or of the last upheld appeal). */
export const APPEAL_WINDOW_HOURS = 48;
export const APPEAL_TEXT_MAX = 1000;
export const APPEAL_TEXT_MIN = 20;
/** Reviewers must explain every decision in writing. */
export const DECISION_NOTE_MIN = 10;
export const DECISION_NOTE_MAX = 2000;

export interface AppealGroundInfo {
  value: AppealGround;
  label: string;
  /** One plain sentence: when this ground applies. */
  description: string;
  /** A concrete example in everyday language. */
  example: string;
}

export const APPEAL_GROUNDS: readonly AppealGroundInfo[] = [
  {
    value: "evidence_overlooked",
    label: "Evidence overlooked",
    description: "The verdict ignored a point or source that is actually in your submission.",
    example: "“I gave three stats in my rebuttal and the verdict says I gave no evidence.”",
  },
  {
    value: "factual_error",
    label: "Factual error in the verdict",
    description: "The verdict states something clearly wrong about what was said, or about a basic fact.",
    example: "“The verdict says I claimed Arsenal won the 2004 Champions League. I never said that.”",
  },
  {
    value: "wrong_rubric",
    label: "Wrong rubric applied",
    description: "The debate was judged against rules that don't match its category.",
    example: "“This was a film-taste debate but it was scored like a fact check.”",
  },
  {
    value: "submission_excluded",
    label: "Submission missing or cut off",
    description: "Part of your opening or rebuttal was missing or truncated when it was judged.",
    example: "“The quotes stop halfway through my opening, as if the rest was never read.”",
  },
  {
    value: "technical_failure",
    label: "Technical failure",
    description: "Something on our side broke and affected the result.",
    example: "“The site was down, so my rebuttal never saved before the deadline.”",
  },
];

export const APPEAL_GROUND_VALUES = APPEAL_GROUNDS.map((g) => g.value) as [AppealGround, ...AppealGround[]];

export function appealGroundLabel(ground: AppealGround): string {
  return APPEAL_GROUNDS.find((g) => g.value === ground)?.label ?? ground;
}

/** Shown wherever a user can start an appeal. */
export const NOT_A_GROUND =
  "“I just disagree” isn't a ground for appeal. An appeal is for a mistake in how the debate was judged, " +
  "not for a result you don't like. Appeals that only disagree are upheld without a re-run.";

export const APPEAL_STATUS_LABELS: Record<AppealStatus, string> = {
  open: "Under review",
  upheld: "Upheld — the verdict stands",
  reevaluated: "Re-evaluation ordered",
  overturned: "Overturned by a reviewer",
};

/** What a reviewer can do with an open appeal (design §4.4). */
export type AppealDecision = "uphold" | "reevaluate" | "overturn";

export const APPEAL_DECISIONS: ReadonlyArray<{ value: AppealDecision; label: string; description: string }> = [
  {
    value: "uphold",
    label: "Uphold",
    description: "The original verdict stands. Use when the ground isn't made out.",
  },
  {
    value: "reevaluate",
    label: "Order re-evaluation",
    description:
      "Run one fresh, full blind dual-order AI evaluation. Its result replaces the current verdict (the old one stays in history). Allowed once per competition.",
  },
  {
    value: "overturn",
    label: "Overturn",
    description: "Set the outcome yourself, with a written reason that both participants will see.",
  },
];
