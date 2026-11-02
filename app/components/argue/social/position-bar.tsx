import { eq } from "drizzle-orm";
import { getSession } from "@domain/auth";
import { db } from "@domain/db";
import { argumentsTable } from "@domain/db/schema";
import { isBlocked } from "@domain/social/blocks";
import { getPositionSummary } from "@domain/social/positions";
import { PositionPicker, type PositionPickerMode } from "./position-picker";

export interface PositionBarProps {
  argumentId: string;
}

/**
 * AGREE / AGAINST counts for an argument plus the viewer's pick-a-side buttons (design §4.1).
 * Positions are free and changeable — clearly labelled as NOT a competition entry.
 */
export async function PositionBar({ argumentId }: PositionBarProps) {
  const viewer = await getSession();
  const argument = await db.query.argumentsTable.findFirst({
    where: eq(argumentsTable.id, argumentId),
    columns: { id: true, status: true, authorId: true },
  });
  if (!argument) return null;

  const summary = await getPositionSummary(argument.id, viewer?.id ?? null);
  let mode: PositionPickerMode = "open";
  if (!viewer) mode = "signed-out";
  else if (argument.status !== "visible") mode = "closed";
  else if (await isBlocked(viewer.id, argument.authorId)) mode = "blocked";

  return (
    <PositionPicker
      initial={summary}
      mode={mode}
      signInHref={`/sign-in?next=${encodeURIComponent(`/a/${argument.id}`)}`}
    />
  );
}
