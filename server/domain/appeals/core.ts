/**
 * Owner: verdict. Shared loaders for a competition's participants and verdicts, used by both the read
 * models (queries.ts) and the decision services (service.ts).
 */
import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@domain/db";
import { competitions, verdicts, type Competition, type Verdict } from "@domain/db/schema";
import { sideForStance, type ParticipantView, type SidePair } from "./verdict-view";

export interface CompetitionCore {
  competition: Competition;
  sides: SidePair;
  category: { id: string; slug: string; name: string };
  argument: { id: string; title: string; removed: boolean } | null;
}

/** Competition + both named sides. Null if it doesn't exist or doesn't have exactly one FOR and one AGAINST side. */
export async function loadCompetitionCore(competitionId: string, conn: DbOrTx = db): Promise<CompetitionCore | null> {
  const row = await conn.query.competitions.findFirst({
    where: eq(competitions.id, competitionId),
    with: {
      participants: { with: { profile: true, user: { columns: { id: true, name: true, status: true } } } },
      category: { columns: { id: true, slug: true, name: true } },
      rootArgument: { columns: { id: true, title: true, status: true } },
    },
  });
  if (!row) return null;

  const views: ParticipantView[] = row.participants.map((p) => {
    const deleted = p.user.status === "deleted";
    return {
      userId: p.userId,
      side: sideForStance(p.side),
      stance: p.side,
      handle: deleted ? null : (p.profile?.handle ?? null),
      displayName: deleted ? "Deleted user" : (p.profile?.displayName ?? p.user.name),
      avatarUrl: deleted ? null : (p.profile?.avatarUrl ?? null),
    };
  });
  const A = views.find((v) => v.side === "A");
  const B = views.find((v) => v.side === "B");
  if (!A || !B) return null;

  const { participants: _participants, category, rootArgument, ...competition } = row;
  void _participants;
  return {
    competition,
    sides: { A, B },
    category,
    argument: rootArgument
      ? { id: rootArgument.id, title: rootArgument.title, removed: rootArgument.status === "removed" }
      : null,
  };
}

export function isParticipant(core: CompetitionCore, userId: string): boolean {
  return core.sides.A.userId === userId || core.sides.B.userId === userId;
}

export async function getCurrentVerdict(competitionId: string, conn: DbOrTx = db): Promise<Verdict | undefined> {
  return conn.query.verdicts.findFirst({
    where: and(eq(verdicts.competitionId, competitionId), eq(verdicts.isCurrent, true)),
  });
}

/** All verdicts for a competition, newest version first. */
export async function getVerdictHistory(competitionId: string, conn: DbOrTx = db): Promise<Verdict[]> {
  return conn.query.verdicts.findMany({
    where: eq(verdicts.competitionId, competitionId),
    orderBy: [desc(verdicts.version)],
  });
}
