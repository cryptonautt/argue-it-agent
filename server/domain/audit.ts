import "server-only";

import { db, type DbOrTx } from "@domain/db";
import { auditLogs, type TargetType } from "@domain/db/schema";

export interface AuditEntry {
  /** Who did it. Null = system (cron, judge, automatic moderation). */
  actorId: string | null;
  /** Dotted verb: "<area>.<verb>", e.g. "competition.accept", "moderation.suspend", "verdict.override". */
  action: string;
  targetType: TargetType;
  targetId: string;
  /** Relevant state before/after (small JSON; never secrets or passwords). */
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

/**
 * Append an immutable audit record (design §4.3.6, §4.4, §4.7, PRD §18). Pass `tx` to make the audit
 * row part of the same transaction as the change it records — do this for every consequential write.
 */
export async function writeAudit(entry: AuditEntry, tx: DbOrTx = db): Promise<void> {
  await tx.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    requestId: entry.requestId ?? null,
  });
}
