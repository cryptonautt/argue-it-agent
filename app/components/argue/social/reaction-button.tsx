import { eq } from "drizzle-orm";
import { getSession } from "@domain/auth";
import { db } from "@domain/db";
import { argumentsTable, comments, type ReactionTarget } from "@domain/db/schema";
import { isBlocked } from "@domain/social/blocks";
import { getReactionSummary } from "@domain/social/reactions";
import { ReactionToggle, type ReactionMode } from "./reaction-toggle";

export interface ReactionButtonProps {
  targetType: ReactionTarget;
  targetId: string;
}

async function loadTarget(targetType: ReactionTarget, targetId: string) {
  if (targetType === "argument") {
    const row = await db.query.argumentsTable.findFirst({
      where: eq(argumentsTable.id, targetId),
      columns: { id: true, authorId: true, status: true },
    });
    return row ? { authorId: row.authorId, open: row.status === "visible", argumentId: row.id } : null;
  }
  const row = await db.query.comments.findFirst({
    where: eq(comments.id, targetId),
    columns: { authorId: true, status: true, argumentId: true },
  });
  return row ? { authorId: row.authorId, open: row.status === "visible", argumentId: row.argumentId } : null;
}

/** React to an argument or comment (one "fire" reaction per user per target). */
export async function ReactionButton({ targetType, targetId }: ReactionButtonProps) {
  const [viewer, target] = await Promise.all([getSession(), loadTarget(targetType, targetId)]);
  if (!target) return null;
  const summary = await getReactionSummary(targetType, targetId, viewer?.id ?? null);

  let mode: ReactionMode = "open";
  if (!viewer) mode = "signed-out";
  else if (viewer.id === target.authorId) mode = "own";
  else if (!target.open || (await isBlocked(viewer.id, target.authorId))) mode = "disabled";

  return (
    <ReactionToggle
      targetType={targetType}
      targetId={targetId}
      initialCount={summary.count}
      initialReacted={summary.viewerReacted}
      mode={mode}
      signInHref={`/sign-in?next=${encodeURIComponent(`/a/${target.argumentId}`)}`}
    />
  );
}
