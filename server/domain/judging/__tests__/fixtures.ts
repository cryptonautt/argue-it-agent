/** Test fixtures for the judge: competitions with frozen submissions, and scripted providers. */
import type { DbOrTx } from "@domain/db";
import type { RulesSnapshot } from "@domain/db/json-types";
import {
  competitionParticipants,
  competitions,
  submissions,
  type CompetitionStatus,
} from "@domain/db/schema";
import { createTestArgument, createTestUser, getCategory, type TestUser } from "@domain/test-helpers/factories";
import { finalizePass, type JudgeRawOutput } from "../output-schema";
import { presentCase, type PresentationLabel } from "../presentation";
import { getRubric } from "../rubrics";
import type {
  ClaimClassification,
  JudgePassInput,
  JudgePassResult,
  JudgeProvider,
  PassOutput,
  PassWinner,
  RubricDef,
  SideLabel,
} from "../types";

export const SPORTS = getRubric("sports", 1) as RubricDef;

export interface SideText {
  opening?: string;
  rebuttal?: string;
  links?: string[];
}

export interface CompetitionFixture {
  competitionId: string;
  forUser: TestUser;
  againstUser: TestUser;
  submissionIds: Record<string, string>;
}

export async function createJudgedCompetition(
  db: DbOrTx,
  options: {
    proposition?: string;
    status?: CompetitionStatus;
    categorySlug?: string;
    forUser?: { handle?: string; displayName?: string };
    againstUser?: { handle?: string; displayName?: string };
    forSide?: SideText;
    againstSide?: SideText;
  } = {},
): Promise<CompetitionFixture> {
  const forUser = await createTestUser(db, options.forUser ?? {});
  const againstUser = await createTestUser(db, options.againstUser ?? {});
  const categorySlug = options.categorySlug ?? "sports";
  const category = await getCategory(db, categorySlug);
  const argument = await createTestArgument(db, forUser.user.id, { categorySlug });
  const proposition = options.proposition ?? "Lionel Messi is a better footballer than Cristiano Ronaldo.";
  const rubric = { id: category.rubricId, version: 1 };
  const snapshot: RulesSnapshot = {
    snapshotVersion: 1,
    format: "direct_v1",
    proposition,
    argumentId: argument.id,
    sourceCommentId: null,
    category: { id: category.id, slug: category.slug, name: category.name },
    rubric,
    challengerId: forUser.user.id,
    recipientId: againstUser.user.id,
    challengerSide: "FOR",
    recipientSide: "AGAINST",
    roundDurationHours: 24,
    acceptWindowHours: 48,
    limits: { openingMaxChars: 4000, rebuttalMaxChars: 2500, maxLinksPerSubmission: 5 },
    rulesText: { noShow: "n", late: "l", cancellation: "c", appeal: "a" },
    sentAt: new Date("2026-10-01T00:00:00Z").toISOString(),
  };
  const [competition] = await db
    .insert(competitions)
    .values({
      rootArgumentId: argument.id,
      creatorId: forUser.user.id,
      categoryId: category.id,
      status: options.status ?? "locked",
      rulesSnapshot: snapshot,
      termsHash: "test-hash",
      rubricId: rubric.id,
      rubricVersion: rubric.version,
      acceptDeadline: new Date("2026-10-03T00:00:00Z"),
    })
    .returning();
  if (!competition) throw new Error("competition insert failed");
  await db.insert(competitionParticipants).values([
    { competitionId: competition.id, userId: forUser.user.id, side: "FOR", role: "challenger", acceptanceStatus: "accepted" },
    { competitionId: competition.id, userId: againstUser.user.id, side: "AGAINST", role: "recipient", acceptanceStatus: "accepted" },
  ]);

  const forSide = options.forSide ?? {
    opening:
      "Messi has 8 Ballon d'Or awards and won the 2022 World Cup. He has more assists than anyone in history, which means he creates as well as scores.",
    rebuttal: "My opponent says Ronaldo scored more goals, but goals per game in La Liga were higher for Messi because he played deeper.",
    links: ["https://example.com/messi-stats"],
  };
  const againstSide = options.againstSide ?? {
    opening: "Ronaldo is the top scorer in men's international football with over 130 goals. He won titles in England, Spain and Italy.",
    rebuttal: "Ballon d'Or votes are popularity contests.",
  };
  const submissionIds: Record<string, string> = {};
  for (const [side, author, text] of [
    ["FOR", forUser, forSide],
    ["AGAINST", againstUser, againstSide],
  ] as const) {
    for (const round of ["opening", "rebuttal"] as const) {
      const body = text[round];
      if (body === undefined) continue;
      const [row] = await db
        .insert(submissions)
        .values({ competitionId: competition.id, authorId: author.user.id, side, round, body, links: text.links ?? [] })
        .returning({ id: submissions.id });
      if (row) submissionIds[`${side}:${round}`] = row.id;
    }
  }
  return { competitionId: competition.id, forUser, againstUser, submissionIds };
}

// --- scripted outputs ------------------------------------------------------------------------------

export interface ScriptedSide {
  /** Score for every criterion (or per key). */
  scores: number | Record<string, number>;
  /** Quotes the judge "cites" for every criterion. Default: the first 30 chars of the side's opening. */
  quotes?: string[];
  claims?: Array<{ claim: string; classification: ClaimClassification }>;
}

export interface ScriptedPass {
  A: ScriptedSide;
  B: ScriptedSide;
  /** The judge's stated winner in CANONICAL labels (converted to X/Y for the pass's order). */
  winner: PassWinner;
  confidence: number;
  margin?: number;
}

/** Build a raw, presentation-labelled output expressing canonical intentions for `input`'s order. */
export function scriptedRaw(input: JudgePassInput, script: ScriptedPass): JudgeRawOutput {
  const presentation = presentCase(input.caseFile, input.order);
  const labelOf = (canonical: SideLabel): PresentationLabel => (presentation.toCanonical.X === canonical ? "X" : "Y");
  const sideFor = (canonical: SideLabel) => {
    const s = script[canonical];
    const presented = presentation.sides.find((p) => p.canonical === canonical);
    const defaultQuote = presented?.opening?.text.slice(0, 30);
    const criteria: JudgeRawOutput["sides"]["X"]["criteria"] = {};
    for (const c of input.rubric.criteria) {
      criteria[c.key] = {
        reason: `Side ${labelOf(canonical)} reason for ${c.key}.`,
        quotes: s.quotes ?? (defaultQuote ? [defaultQuote] : []),
        score: typeof s.scores === "number" ? s.scores : (s.scores[c.key] ?? 5),
      };
    }
    return {
      criteria,
      claims: s.claims ?? [],
      strengths: [`Side ${labelOf(canonical)} strength.`],
      weaknesses: [`Side ${labelOf(canonical)} weakness.`],
    };
  };
  const X = sideFor(presentation.toCanonical.X);
  const Y = sideFor(presentation.toCanonical.Y);
  return {
    sides: { X, Y },
    rationale: `Side ${script.winner === "draw" ? "X" : labelOf(script.winner)} made the stronger case.`,
    winner: script.winner === "draw" ? "draw" : labelOf(script.winner),
    margin: script.margin ?? 10,
    confidence: script.confidence,
  };
}

export type Script = (input: JudgePassInput, call: number) => ScriptedPass | JudgePassResult;

/** A fake provider that answers each pass from a script (by pass number / call count). */
export class ScriptedProvider implements JudgeProvider {
  readonly id = "scripted";
  readonly model = "scripted-model";
  calls: JudgePassInput[] = [];

  constructor(private readonly script: Script) {}

  async runPass(input: JudgePassInput): Promise<JudgePassResult> {
    this.calls.push(input);
    const answer = this.script(input, this.calls.length);
    if ("ok" in answer) return answer;
    const raw = scriptedRaw(input, answer);
    const output: PassOutput = finalizePass(raw, presentCase(input.caseFile, input.order), input.rubric, input.passNo);
    return { ok: true, output, raw, usage: { inputTokens: 100, outputTokens: 50 }, latencyMs: 5, stopReason: "end_turn" };
  }
}

export const clearWin = (winner: SideLabel, confidence = 0.85): ScriptedPass => ({
  A: { scores: winner === "A" ? 8 : 5 },
  B: { scores: winner === "B" ? 8 : 5 },
  winner,
  confidence,
});

export const providerError = (retryable = true): JudgePassResult => ({
  ok: false,
  kind: "provider_error",
  error: "upstream 529 overloaded",
  retryable,
  latencyMs: 3,
  usage: null,
});

export const refusal = (): JudgePassResult => ({
  ok: false,
  kind: "refusal",
  error: "the AI judge declined to evaluate this debate (category: general_harms)",
  retryable: false,
  latencyMs: 3,
  usage: null,
  stopReason: "refusal",
});

/** A canonical PassOutput built directly (for pure comparePasses tests). */
export function passOutput(
  passNo: number,
  order: "AB" | "BA",
  scoresA: number,
  scoresB: number,
  winner: PassWinner,
  confidence: number,
  rubric: RubricDef = SPORTS,
): PassOutput {
  const side = (score: number) => ({
    criteria: Object.fromEntries(rubric.criteria.map((c) => [c.key, { score, reason: "r", quotes: [] }])),
    claims: [],
    strengths: [],
    weaknesses: [],
  });
  return { passNo, order, sides: { A: side(scoresA), B: side(scoresB) }, winner, margin: 0, confidence, rationale: "", invalidQuoteCount: 0 };
}
