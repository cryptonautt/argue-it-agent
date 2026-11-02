/**
 * The blind case file (design §4.3.1): everything the judge may see and nothing else.
 *
 * Built from the frozen terms (rules_snapshot) and frozen submissions only. Side A is ALWAYS the FOR side,
 * Side B the AGAINST side. No user ids, names, handles, avatars, follower counts, reactions, position
 * counts, ratings, or who challenged whom — and participant identities mentioned inside the text are
 * redacted. Submission moderation status (hidden/removed for display) never affects what is judged.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db as defaultDb, type DbOrTx } from "@domain/db";
import type { InjectionFinding, SideLabel } from "@domain/db/json-types";
import {
  categories,
  competitionParticipants,
  competitions,
  profiles,
  submissions,
  users,
  type CompetitionRound,
  type CompetitionSide,
} from "@domain/db/schema";
import { canonicalJson, sha256Hex } from "./canonical";
import { scanForInjection } from "./injection";
import { buildRedactionTargets, redactIdentities, type ParticipantIdentity } from "./redact";
import type { BuiltCaseFile, CaseFile, CaseSide, CaseSubmission } from "./types";

export const CASE_FILE_SCHEMA_VERSION = 1 as const;

export const sideLabelFor = (side: CompetitionSide): SideLabel => (side === "FOR" ? "A" : "B");

export interface RawSubmission {
  id: string;
  side: CompetitionSide;
  round: CompetitionRound;
  body: string;
  links: string[];
}

export interface CaseFileInput {
  proposition: string;
  category: { slug: string; name: string };
  rubric: { id: string; version: number };
  participants: ParticipantIdentity[];
  submissions: RawSubmission[];
}

export interface AssembledCaseFile extends BuiltCaseFile {
  /** Submission id per side+round, so injection findings can open reports on the right target. */
  submissionIds: Partial<Record<`${SideLabel}:${CompetitionRound}`, string>>;
  /** Bare names left unredacted because they are the debate's subject (see buildRedactionTargets). */
  exemptTerms: string[];
}

/** Pure: assemble, redact, scan and hash a case file from already-loaded rows. */
export function assembleCaseFile(input: CaseFileInput): AssembledCaseFile {
  const { targets, exemptTerms } = buildRedactionTargets(input.participants, input.proposition);
  let redactionCount = 0;
  const redact = (text: string) => {
    const result = redactIdentities(text, targets);
    redactionCount += result.redactions;
    return result.text;
  };

  const proposition = redact(input.proposition);
  const injectionFindings: InjectionFinding[] = scanForInjection(proposition).findings;
  const submissionIds: AssembledCaseFile["submissionIds"] = {};

  const submissionFor = (side: CompetitionSide, round: CompetitionRound): CaseSubmission | null => {
    const row = input.submissions.find((s) => s.side === side && s.round === round);
    if (!row) return null;
    const label = sideLabelFor(side);
    submissionIds[`${label}:${round}`] = row.id;
    const text = redact(row.body);
    for (const finding of scanForInjection(text).findings) injectionFindings.push({ ...finding, side: label, round });
    // Link URLs can carry identities too (e.g. a profile link); redact path segments the same way.
    const links = row.links.map((link) => redact(link));
    return { text, links };
  };

  const side = (stance: CompetitionSide): CaseSide => ({
    label: sideLabelFor(stance),
    stance,
    opening: submissionFor(stance, "opening"),
    rebuttal: submissionFor(stance, "rebuttal"),
  });

  const caseFile: CaseFile = {
    schemaVersion: CASE_FILE_SCHEMA_VERSION,
    proposition,
    category: { slug: input.category.slug, name: input.category.name },
    rubric: { id: input.rubric.id, version: input.rubric.version },
    sides: { A: side("FOR"), B: side("AGAINST") },
  };

  return {
    caseFile,
    caseHash: hashCaseFile(caseFile),
    injectionFindings,
    redactionCount,
    submissionIds,
    exemptTerms,
  };
}

export function hashCaseFile(caseFile: CaseFile): string {
  return sha256Hex(canonicalJson(caseFile));
}

export class CaseFileError extends Error {
  override readonly name = "CaseFileError";
}

/** Load the frozen rows for a competition and assemble its blind case file. */
export async function loadCaseFile(competitionId: string, tx: DbOrTx = defaultDb): Promise<AssembledCaseFile> {
  const [competition] = await tx
    .select({
      id: competitions.id,
      rulesSnapshot: competitions.rulesSnapshot,
      rubricId: competitions.rubricId,
      rubricVersion: competitions.rubricVersion,
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(competitions)
    .innerJoin(categories, eq(categories.id, competitions.categoryId))
    .where(eq(competitions.id, competitionId))
    .limit(1);
  if (!competition) throw new CaseFileError(`competition ${competitionId} not found`);

  const participantRows = await tx
    .select({
      userId: competitionParticipants.userId,
      side: competitionParticipants.side,
      handle: profiles.handle,
      displayName: profiles.displayName,
      accountName: users.name,
    })
    .from(competitionParticipants)
    .innerJoin(users, eq(users.id, competitionParticipants.userId))
    .leftJoin(profiles, eq(profiles.userId, competitionParticipants.userId))
    .where(eq(competitionParticipants.competitionId, competitionId));
  if (participantRows.length !== 2) {
    throw new CaseFileError(`competition ${competitionId} has ${participantRows.length} participants, expected 2`);
  }

  const participantIds = participantRows.map((p) => p.userId);
  const submissionRows = await tx
    .select({
      id: submissions.id,
      side: submissions.side,
      round: submissions.round,
      body: submissions.body,
      links: submissions.links,
      authorId: submissions.authorId,
    })
    .from(submissions)
    .where(and(eq(submissions.competitionId, competitionId), inArray(submissions.authorId, participantIds)));

  // Frozen terms win over the live argument/category rows (the snapshot is what both sides accepted).
  const snapshot = competition.rulesSnapshot;
  return assembleCaseFile({
    proposition: snapshot.proposition,
    category: { slug: snapshot.category.slug || competition.categorySlug, name: snapshot.category.name || competition.categoryName },
    rubric: { id: competition.rubricId, version: competition.rubricVersion },
    participants: participantRows.map((p) => ({
      side: p.side,
      handle: p.handle,
      displayName: p.displayName,
      accountName: p.accountName,
    })),
    submissions: submissionRows.map((s) => ({ id: s.id, side: s.side, round: s.round, body: s.body, links: s.links })),
  });
}

