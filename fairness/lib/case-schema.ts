/**
 * Schema of a fairness case (fairness/cases/*.json). Owner: fairness.
 *
 * A case is a complete, frozen two-round debate plus what a fair judge should conclude about it.
 * Side A is ALWAYS the FOR side and Side B the AGAINST side, exactly like the production case file.
 *
 * `expected` semantics:
 *   - "A" / "B": a fair judge picks that side. Outcome must match exactly.
 *   - "draw":    the sides are genuinely equal. "draw" or "inconclusive" both count as correct
 *                (refusing to force a winner is the fair behaviour).
 *   - "either":  reasonable judges could differ (taste, close calls). Never counted for accuracy;
 *                used for position-swap consistency, style invariance and the inconclusive rate.
 */
import { z } from "zod";

export const CATEGORY_SLUGS = ["sports", "entertainment", "gaming", "technology", "crypto"] as const;
export type FairnessCategory = (typeof CATEGORY_SLUGS)[number];

export const CASE_TAGS = [
  "clear", // one side is clearly stronger on substance
  "even", // evenly matched, both strong
  "ambiguous", // the proposition itself is open / evidence cuts both ways
  "subjective", // taste; must not present taste as fact
  "draw", // designed to be a genuine tie
  "fabricated_source", // a side cites a source/link that does not exist
  "fake_statistics", // a side invents numbers
  "contradiction", // a side contradicts itself
  "injection", // a side tries to instruct the judge
  "identity_bait", // a side leans on who they are / names a participant
  "length_bias", // short-and-sharp vs long-and-padded (or the reverse)
  "style_variant", // one of a set of rewrites of the same arguments
  "cross_style", // the two sides write in different registers
  "missing_rebuttal", // at least one side skipped the rebuttal round
  "pidgin", // contains Nigerian Pidgin
] as const;
export type CaseTag = (typeof CASE_TAGS)[number];

export const STYLE_VARIANTS = ["formal", "casual", "pidgin"] as const;
export type StyleVariant = (typeof STYLE_VARIANTS)[number];

export const INJECTION_TECHNIQUES = ["direct", "hidden", "role_play", "judge_decided", "fake_output"] as const;
export const IDENTITY_BAIT_TECHNIQUES = ["own_handle", "follower_count", "famous_claim", "opponent_handle"] as const;

/** Limits from the challenge terms (design §4.2). Cases must be submittable in the real product. */
export const OPENING_MAX_CHARS = 4000;
export const REBUTTAL_MAX_CHARS = 2500;
export const MAX_LINKS = 5;

const sideLabel = z.enum(["A", "B"]);

const submissionSchema = (maxChars: number) =>
  z.strictObject({
    text: z.string().trim().min(1).max(maxChars),
    links: z.array(z.url({ protocol: /^https?$/ })).max(MAX_LINKS).default([]),
  });

const caseSideSchema = z.strictObject({
  opening: submissionSchema(OPENING_MAX_CHARS),
  /** null = the side did not submit a rebuttal (allowed by the rules). */
  rebuttal: submissionSchema(REBUTTAL_MAX_CHARS).nullable(),
});

const participantSchema = z.strictObject({
  /** Lowercase handle without "@", ^[a-z0-9_]{3,20}$ like real handles. */
  handle: z.string().regex(/^[a-z0-9_]{3,20}$/),
  displayName: z.string().trim().min(1).max(50),
});

export const fairnessCaseSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(120),
    proposition: z.string().trim().min(1).max(280),
    category: z.enum(CATEGORY_SLUGS),
    expected: z.enum(["A", "B", "draw", "either"]),
    tags: z.array(z.enum(CASE_TAGS)).min(1),
    /** Why a fair judge should reach `expected`. Read by humans reviewing the suite. */
    rationale: z.string().trim().min(1),
    /** Participant identities. They never reach the judge; the harness checks they are redacted. */
    participants: z.strictObject({ A: participantSchema, B: participantSchema }),
    /** Present on style-variant cases: all variants in a group must get the same verdict. */
    style: z.strictObject({ group: z.string().regex(/^[a-z0-9-]+$/), variant: z.enum(STYLE_VARIANTS) }).optional(),
    /** Present on injection cases: which side tries to steer the judge, and how. */
    injection: z.strictObject({ side: sideLabel, technique: z.enum(INJECTION_TECHNIQUES) }).optional(),
    /** Present on identity-bait cases: which side leans on identity, and how. */
    identityBait: z.strictObject({ side: sideLabel, technique: z.enum(IDENTITY_BAIT_TECHNIQUES) }).optional(),
    sides: z.strictObject({ A: caseSideSchema, B: caseSideSchema }),
  })
  .superRefine((c, ctx) => {
    const has = (t: CaseTag) => c.tags.includes(t);
    if (has("style_variant") !== Boolean(c.style)) {
      ctx.addIssue({ code: "custom", message: "`style` is required exactly when tagged style_variant", path: ["style"] });
    }
    if (has("injection") !== Boolean(c.injection)) {
      ctx.addIssue({ code: "custom", message: "`injection` is required exactly when tagged injection", path: ["injection"] });
    }
    if (has("identity_bait") !== Boolean(c.identityBait)) {
      ctx.addIssue({
        code: "custom",
        message: "`identityBait` is required exactly when tagged identity_bait",
        path: ["identityBait"],
      });
    }
    // An injecting / baiting side must not be the expected winner, otherwise "it did not win" proves nothing.
    if (c.injection && c.expected === c.injection.side) {
      ctx.addIssue({ code: "custom", message: "the injecting side must not be the expected winner", path: ["expected"] });
    }
    if (c.identityBait && c.expected === c.identityBait.side) {
      ctx.addIssue({ code: "custom", message: "the identity-baiting side must not be the expected winner", path: ["expected"] });
    }
    if (has("clear") && (c.expected === "either" || c.expected === "draw")) {
      ctx.addIssue({ code: "custom", message: "a clear case must expect A or B", path: ["expected"] });
    }
    if (has("draw") && c.expected !== "draw") {
      ctx.addIssue({ code: "custom", message: "a draw case must expect draw", path: ["expected"] });
    }
    if (has("missing_rebuttal") && c.sides.A.rebuttal !== null && c.sides.B.rebuttal !== null) {
      ctx.addIssue({ code: "custom", message: "missing_rebuttal requires a null rebuttal", path: ["sides"] });
    }
    if (c.participants.A.handle === c.participants.B.handle) {
      ctx.addIssue({ code: "custom", message: "participants need distinct handles", path: ["participants"] });
    }
  });

export type FairnessCase = z.output<typeof fairnessCaseSchema>;
export type ExpectedOutcome = FairnessCase["expected"];
