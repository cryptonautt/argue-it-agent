import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getSession } from "@domain/auth";

import { domainErrors, throwDomainFailure } from "../server/lib/domain-action.js";

/**
 * Who-am-I for the screens (requested by 5-screens-a/5b; not in the plan's table). Server loaders are
 * anonymous on this framework, so the client asks here. Signed out → `null`; signed in to the framework
 * without an ARGUE IT profile → NEEDS_HANDLE (via the shared error mapping).
 */
export default defineAction({
  description: "Return the signed-in ARGUE IT user (id, role, handle, status), or null when signed out.",
  schema: z.object({}),
  outputSchema: z
    .object({
      id: z.string(),
      role: z.enum(["user", "moderator", "admin"]),
      status: z.string(),
      suspendedUntil: z.string().nullable(),
      handle: z.string().nullable(),
      displayName: z.string().nullable(),
      avatarUrl: z.string().nullable(),
    })
    .nullable(),
  errors: domainErrors,
  http: { method: "GET" },
  agentTool: false,
  persistInBrowser: false,
  run: async () => {
    const user = await getSession();
    if (user) {
      return {
        id: user.id,
        role: user.role,
        status: user.status,
        suspendedUntil: user.suspendedUntil ? user.suspendedUntil.toISOString() : null,
        handle: user.handle,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      };
    }
    // Maps to NEEDS_HANDLE when the framework has a session but there is no `users` row; otherwise signed out.
    try {
      await throwDomainFailure({ error: "Sign in to do that.", code: "UNAUTHENTICATED" });
    } catch (error) {
      if ((error as { errorCode?: string }).errorCode === "UNAUTHENTICATED") return null;
      throw error;
    }
    return null;
  },
});
