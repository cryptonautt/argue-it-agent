import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { runAction } from "@domain/action";
import { writeAudit } from "@domain/audit";
import { ensureAppUser } from "@domain/auth";
import { db } from "@domain/db";
import { isUniqueViolation } from "@domain/db/errors";
import { profiles, users } from "@domain/db/schema";
import { ActionError, ok } from "@domain/lib/action-result";

import { domainErrors, runDomain } from "../server/lib/domain-action.js";
import { createProfileInput } from "../server/lib/domain-action-schemas.js";

const HANDLE_TAKEN = "That handle is taken. Try another.";

/**
 * New in the port (no reference equivalent): the framework owns sign-up, so the first visit of a signed-in
 * email has no ARGUE IT `users` row. /welcome calls this to create `users` + `profiles` with a chosen handle.
 */
export default defineAction({
  description:
    "Finish onboarding: create the signed-in person's ARGUE IT profile with a chosen handle (3–20 lowercase letters, numbers or underscores) and optional display name. Fails with CONFLICT when the handle is taken or a profile already exists.",
  schema: createProfileInput,
  outputSchema: z.object({ userId: z.string(), handle: z.string(), displayName: z.string() }),
  errors: domainErrors,
  http: { method: "POST" },
  link: ({ result }) => (result?.handle ? { url: `/u/${result.handle}`, label: "Open profile" } : null),
  run: async ({ handle, displayName }, ctx) =>
    runDomain(
      runAction(async () => {
        const email = (ctx?.userEmail ?? getRequestUserEmail())?.trim().toLowerCase();
        if (!email) throw new ActionError("UNAUTHENTICATED", "Sign in to do that.");
        if ((await ensureAppUser(email)) !== "needs-handle") {
          throw new ActionError("CONFLICT", "You already have an ARGUE IT profile.");
        }
        const name = displayName ?? handle;

        const [taken] = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.handle, handle)).limit(1);
        if (taken) throw new ActionError("CONFLICT", HANDLE_TAKEN, { handle: [HANDLE_TAKEN] });

        try {
          const userId = await db.transaction(async (tx) => {
            // ensureAppUser also says "needs-handle" for a `users` row without a profile (e.g. seeded rows):
            // reuse that row instead of tripping the unique email constraint.
            const [existing] = await tx
              .select({ id: users.id })
              .from(users)
              .where(sql`lower(${users.email}) = ${email}`)
              .limit(1);
            const id =
              existing?.id ?? (await tx.insert(users).values({ name, email }).returning({ id: users.id }))[0]?.id;
            if (!id) throw new Error("users insert returned no row");
            await tx.insert(profiles).values({ userId: id, handle, displayName: name });
            await writeAudit(
              { actorId: id, action: "profile.create", targetType: "user", targetId: id, after: { handle } },
              tx,
            );
            return id;
          });
          return ok({ userId, handle, displayName: name });
        } catch (error) {
          // Lost a race for the handle (or the email) to a concurrent request.
          if (isUniqueViolation(error)) throw new ActionError("CONFLICT", HANDLE_TAKEN, { handle: [HANDLE_TAKEN] });
          throw error;
        }
      }),
    ),
});
