/**
 * Owner: challenges. Read models for the competition room, the challenge list on an argument, and the
 * challenge setup page. Every read lazily enforces deadlines first. Sealing is applied HERE, on the
 * server: sealed text never leaves the database for anyone but its author.
 */
import "server-only";

import { and, desc, eq, notInArray } from "drizzle-orm";
import { isActionError } from "@domain/lib/action-result";
import { now } from "@domain/lib/time";
import { hasRole, isSuspended, type SessionUser } from "@domain/auth/roles";
import { db } from "@domain/db";
import type { RulesSnapshot } from "@domain/db/json-types";
import {
  competitions,
  verdicts,
  type CompetitionRound,
  type CompetitionStatus,
  type ContentStatus,
} from "@domain/db/schema";
import { advanceCompetition } from "./lifecycle";
import { getPinnedRubric, type RubricView } from "./rubric";
import { currentDeadline, isDue, phaseOf, type CompetitionSide, type ParticipantRole, type Phase } from "./state-machine";
import { termsFingerprint } from "./terms";
import { submissionVisibility } from "./visibility";

// ---------------------------------------------------------------------------------------------------
// Competition room
// ---------------------------------------------------------------------------------------------------

export interface RoomParticipantView {
  userId: string;
  role: ParticipantRole;
  side: CompetitionSide;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  cancelRequested: boolean;
  locked: Record<CompetitionRound, boolean>;
}

export type RoomSubmissionView =
  /** Sealed: content withheld. Whether it even exists is not revealed. */
  | { visibility: "sealed" }
  | { visibility: "moderated" }
  | { visibility: "empty" }
  | {
      visibility: "visible";
      id: string;
      body: string;
      links: string[];
      updatedAt: string;
      lockedAt: string | null;
      /** Only the author ever sees their own hidden/removed submission's text. */
      moderated: boolean;
    };

export interface CompetitionRoomView {
  id: string;
  status: CompetitionStatus;
  round: CompetitionRound | null;
  phase: Phase;
  argument: { id: string; title: string; status: ContentStatus };
  terms: RulesSnapshot;
  termsHash: string;
  termsFingerprint: string;
  rubric: RubricView | null;
  timeline: {
    sentAt: string;
    acceptDeadline: string;
    acceptedAt: string | null;
    openingClosesAt: string | null;
    rebuttalClosesAt: string | null;
    lockedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
  };
  /** ISO deadline currently running (pending → accept deadline, active → current round's). */
  deadline: string | null;
  cancelReason: string | null;
  declineReason: string | null;
  challenger: RoomParticipantView;
  recipient: RoomParticipantView;
  viewer: {
    userId: string | null;
    role: ParticipantRole | null;
    isAdmin: boolean;
    /** Signed in, not suspended. */
    canWrite: boolean;
  };
  submissions: Record<CompetitionRound, Record<ParticipantRole, RoomSubmissionView>>;
  hasVerdict: boolean;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The room as `viewer` may see it, after enforcing deadlines. Null if the competition doesn't exist. */
export async function getCompetitionRoom(
  competitionId: string,
  viewer: SessionUser | null,
): Promise<CompetitionRoomView | null> {
  try {
    await advanceCompetition(competitionId);
  } catch (error) {
    if (isActionError(error) && error.code === "NOT_FOUND") return null;
    throw error;
  }

  const row = await db.query.competitions.findFirst({
    where: eq(competitions.id, competitionId),
    with: {
      participants: { with: { profile: true } },
      submissions: true,
      rootArgument: { columns: { id: true, title: true, status: true } },
    },
  });
  if (!row) return null;

  const [verdict] = await db
    .select({ id: verdicts.id })
    .from(verdicts)
    .where(and(eq(verdicts.competitionId, competitionId), eq(verdicts.isCurrent, true)))
    .limit(1);
  const rubric = await getPinnedRubric(row.rubricId, row.rubricVersion);

  const participant = (role: ParticipantRole): RoomParticipantView => {
    const p = row.participants.find((candidate) => candidate.role === role);
    if (!p) throw new Error(`competition ${row.id} has no ${role}`);
    const lockedFor = (round: CompetitionRound) =>
      row.submissions.some((s) => s.authorId === p.userId && s.round === round && s.lockedAt !== null);
    return {
      userId: p.userId,
      role,
      side: p.side,
      handle: p.profile?.handle ?? "deleted",
      displayName: p.profile?.displayName ?? "Deleted user",
      avatarUrl: p.profile?.avatarUrl ?? null,
      cancelRequested: p.cancelRequestedAt !== null,
      locked: { opening: lockedFor("opening"), rebuttal: lockedFor("rebuttal") },
    };
  };
  const challenger = participant("challenger");
  const recipient = participant("recipient");
  const viewerRole: ParticipantRole | null =
    viewer?.id === challenger.userId ? "challenger" : viewer?.id === recipient.userId ? "recipient" : null;

  const submissionView = (role: ParticipantRole, round: CompetitionRound): RoomSubmissionView => {
    const author = role === "challenger" ? challenger : recipient;
    const found = row.submissions.find((s) => s.authorId === author.userId && s.round === round);
    const visibility = submissionVisibility({
      state: row,
      round,
      viewerIsAuthor: viewer?.id === author.userId,
      submissionStatus: found?.status ?? "visible",
    });
    if (visibility === "sealed") return { visibility: "sealed" };
    if (!found) return { visibility: "empty" };
    if (visibility === "moderated") return { visibility: "moderated" };
    return {
      visibility: "visible",
      id: found.id,
      body: found.body,
      links: found.links,
      updatedAt: found.updatedAt.toISOString(),
      lockedAt: iso(found.lockedAt),
      moderated: found.status !== "visible",
    };
  };

  return {
    id: row.id,
    status: row.status,
    round: row.round,
    phase: phaseOf(row),
    argument: row.rootArgument,
    terms: row.rulesSnapshot,
    termsHash: row.termsHash,
    termsFingerprint: termsFingerprint(row.termsHash),
    rubric,
    timeline: {
      sentAt: row.sentAt.toISOString(),
      acceptDeadline: row.acceptDeadline.toISOString(),
      acceptedAt: iso(row.acceptedAt),
      openingClosesAt: iso(row.openingClosesAt),
      rebuttalClosesAt: iso(row.rebuttalClosesAt),
      lockedAt: iso(row.lockedAt),
      completedAt: iso(row.completedAt),
      cancelledAt: iso(row.cancelledAt),
    },
    deadline: iso(currentDeadline(row)),
    cancelReason: row.cancelReason,
    declineReason: row.declineReason,
    challenger,
    recipient,
    viewer: {
      userId: viewer?.id ?? null,
      role: viewerRole,
      isAdmin: viewer ? hasRole(viewer.role, "admin") : false,
      canWrite: viewer !== null && !isSuspended(viewer),
    },
    submissions: {
      opening: { challenger: submissionView("challenger", "opening"), recipient: submissionView("recipient", "opening") },
      rebuttal: {
        challenger: submissionView("challenger", "rebuttal"),
        recipient: submissionView("recipient", "rebuttal"),
      },
    },
    hasVerdict: verdict !== undefined,
  };
}

/** The proposition, for page titles. Does not enforce deadlines (metadata only). */
export async function getCompetitionTitle(competitionId: string): Promise<string | null> {
  const [row] = await db
    .select({ snapshot: competitions.rulesSnapshot })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  if (!row) return null;
  const text = row.snapshot.proposition;
  return text.length > 70 ? `${text.slice(0, 69)}…` : text;
}

// ---------------------------------------------------------------------------------------------------
// Challenges on an argument
// ---------------------------------------------------------------------------------------------------

export interface ChallengeListSide {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  side: CompetitionSide;
}

export interface ChallengeListItem {
  id: string;
  status: CompetitionStatus;
  phase: Phase;
  proposition: string;
  challenger: ChallengeListSide;
  recipient: ChallengeListSide;
  deadline: string | null;
  sentAt: string;
  completedAt: string | null;
}

/** Private outcomes that are not shown publicly on the argument page. */
const HIDDEN_FROM_LIST: CompetitionStatus[] = ["declined", "withdrawn", "expired"];
const LIST_LIMIT = 20;

export async function listArgumentChallenges(argumentId: string): Promise<ChallengeListItem[]> {
  const load = () =>
    db.query.competitions.findMany({
      where: and(eq(competitions.rootArgumentId, argumentId), notInArray(competitions.status, HIDDEN_FROM_LIST)),
      with: { participants: { with: { profile: true } } },
      orderBy: [desc(competitions.sentAt)],
      limit: LIST_LIMIT,
    });

  let rows = await load();
  const at = now();
  const due = rows.filter((row) => isDue(row, at));
  if (due.length > 0) {
    for (const row of due) await advanceCompetition(row.id);
    rows = await load();
  }

  return rows.flatMap((row) => {
    const side = (role: ParticipantRole): ChallengeListSide | null => {
      const p = row.participants.find((candidate) => candidate.role === role);
      if (!p) return null;
      return {
        handle: p.profile?.handle ?? "deleted",
        displayName: p.profile?.displayName ?? "Deleted user",
        avatarUrl: p.profile?.avatarUrl ?? null,
        side: p.side,
      };
    };
    const challenger = side("challenger");
    const recipient = side("recipient");
    if (!challenger || !recipient) return [];
    return [
      {
        id: row.id,
        status: row.status,
        phase: phaseOf(row),
        proposition: row.rulesSnapshot.proposition,
        challenger,
        recipient,
        deadline: iso(currentDeadline(row)),
        sentAt: row.sentAt.toISOString(),
        completedAt: iso(row.completedAt),
      },
    ];
  });
}
