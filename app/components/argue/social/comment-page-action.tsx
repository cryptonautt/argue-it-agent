"use server";

/**
 * "Load more comments" — returns the next page already rendered on the server, so per-comment controls
 * owned by other teams (ReportButton, ChallengeButton) work exactly as on the first page. Read-only.
 */

import type { ReactNode } from "react";
import { z } from "zod";
import { ok, type ActionResult } from "@domain/lib/action-result";
import { parseInput, runAction } from "@domain/action";
import { getSession } from "@domain/auth";
import { isBlocked } from "@domain/social/blocks";
import { listCommentThreads } from "@domain/social/comments";
import { loadArgument } from "@domain/social/guards";
import { CommentThreadItems } from "./comment-thread-items";

const schema = z.object({ argumentId: z.uuid(), cursor: z.string().min(1).max(200) });

export async function loadMoreComments(
  input: z.input<typeof schema>,
): Promise<ActionResult<{ node: ReactNode; count: number; nextCursor: string | null }>> {
  return runAction(async () => {
    const data = parseInput(schema, input);
    const viewer = await getSession();
    const argument = await loadArgument(data.argumentId);
    const blocked = viewer ? await isBlocked(viewer.id, argument.authorId) : false;
    const page = await listCommentThreads({ argumentId: argument.id, viewerId: viewer?.id ?? null, cursor: data.cursor });
    const node = (
      <CommentThreadItems
        threads={page.threads}
        ctx={{
          viewerId: viewer?.id ?? null,
          argumentId: argument.id,
          argumentOpen: argument.status === "visible" && !blocked,
          signInHref: `/sign-in?next=${encodeURIComponent(`/a/${argument.id}`)}`,
        }}
      />
    );
    return ok({ node, count: page.threads.length, nextCursor: page.nextCursor });
  });
}
