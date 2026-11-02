import "server-only";
/**
 * Owner: challenges (extracted by integration so the action and the demo seed share one implementation).
 * Creates a pending direct challenge inside the caller's transaction: resolves the target, refuses
 * duplicates and blocks (via resolveChallengeTarget), pins the current rubric, freezes the terms
 * (rules_snapshot + sha256 terms_hash), inserts both participants, notifies the recipient and audits.
 */
import { ActionError } from "@domain/lib/action-result";
import { addHours } from "@domain/lib/time";
import { writeAudit } from "@domain/audit";
import type { Tx } from "@domain/db";
import { competitionParticipants, competitions, type CompetitionSide } from "@domain/db/schema";
import { notify } from "@domain/notifications";
import { enforceRateLimit } from "@domain/rate-limit";
import { getCurrentRubric } from "./rubric";
import { findOpenChallenge, resolveChallengeTarget, type TargetInput } from "./targets";
import { ACCEPT_WINDOW_HOURS, buildRulesSnapshot } from "./terms";
import { hashTerms } from "./terms-hash";

export interface CreateChallengeInput extends TargetInput {
  proposition: string;
  challengerSide: CompetitionSide;
  roundDurationHours: 24 | 48 | 72;
}

/** Returns the new competition id. Throws ActionError for anything the challenger can fix. */
export async function createChallenge(tx: Tx, challengerId: string, data: CreateChallengeInput, at: Date): Promise<string> {
  const user = { id: challengerId };
  const { roundDurationHours } = data;
  const target = await resolveChallengeTarget(user.id, data, tx);
  if (!target.opponent) {
    throw new ActionError("VALIDATION", "Choose who you want to challenge.", {
      opponentHandle: ["Enter the handle of the person you want to challenge."],
    });
  }
  const existing = await findOpenChallenge(target.argument.id, user.id, target.opponent.userId, at, tx);
  if (existing) {
    throw new ActionError(
      "CONFLICT",
      `You already have an open challenge with @${target.opponent.handle} on this argument.`,
    );
  }
  const rubric = await getCurrentRubric(target.category.rubricId, tx);
  if (!rubric) {
    throw new ActionError(
      "CONFLICT",
      "The judging rubric for this category isn't available right now, so challenges can't be sent. Please try again later.",
    );
  }
  await enforceRateLimit(user.id, "challenge", tx);

  const snapshot = buildRulesSnapshot({
    proposition: data.proposition,
    argumentId: target.argument.id,
    sourceCommentId: target.comment?.id ?? null,
    category: target.category,
    rubric: { id: rubric.id, version: rubric.version },
    challengerId: user.id,
    recipientId: target.opponent.userId,
    challengerSide: data.challengerSide,
    roundDurationHours,
    sentAt: at,
  });
  const termsHash = hashTerms(snapshot);

  const [row] = await tx
    .insert(competitions)
    .values({
      rootArgumentId: target.argument.id,
      sourceCommentId: target.comment?.id ?? null,
      creatorId: user.id,
      categoryId: target.category.id,
      status: "pending_acceptance",
      round: null,
      rulesSnapshot: snapshot,
      termsHash,
      rubricId: rubric.id,
      rubricVersion: rubric.version,
      sentAt: at,
      acceptDeadline: addHours(at, ACCEPT_WINDOW_HOURS),
      createdAt: at,
      updatedAt: at,
    })
    .returning({ id: competitions.id });
  if (!row) throw new Error("competition insert returned no row");

  await tx.insert(competitionParticipants).values([
    {
      competitionId: row.id,
      userId: user.id,
      side: snapshot.challengerSide,
      role: "challenger",
      acceptanceStatus: "accepted",
      acceptedAt: at,
      createdAt: at,
    },
    {
      competitionId: row.id,
      userId: target.opponent.userId,
      side: snapshot.recipientSide,
      role: "recipient",
      acceptanceStatus: "pending",
      createdAt: at,
    },
  ]);

  await notify(
    {
      userId: target.opponent.userId,
      actorId: user.id,
      type: "challenge_received",
      targetType: "competition",
      targetId: row.id,
      data: {
        proposition: snapshot.proposition.slice(0, 100),
        argumentTitle: target.argument.title.slice(0, 100),
        yourSide: snapshot.recipientSide,
      },
    },
    tx,
  );
  await writeAudit(
    {
      actorId: user.id,
      action: "competition.send",
      targetType: "competition",
      targetId: row.id,
      after: {
        recipientId: target.opponent.userId,
        challengerSide: snapshot.challengerSide,
        roundDurationHours,
        rubric: snapshot.rubric,
        termsHash,
      },
    },
    tx,
  );
  return row.id;
}
