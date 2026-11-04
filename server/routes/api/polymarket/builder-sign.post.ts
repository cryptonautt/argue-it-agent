/**
 * Remote Builder Signing endpoint for in-app Polymarket trading (docs.polymarket.com/trading/wallets-auth.md).
 *
 * The browser SDK (`remoteBuilderSigning`) posts `{ method, path, body }` for each Builder-authenticated
 * relayer request it is about to send; this returns the four POLY_BUILDER_* headers for that one request.
 * The Builder API secret never leaves the server.
 *
 * A custom route (not an action) because the SDK owns the wire contract: it expects the headers object as
 * the whole JSON response. It is a trust boundary, so it re-establishes the same rules an action would:
 * signed-in ARGUE IT user, not suspended, same-origin caller, per-user rate limit, validated input.
 */
import { getSession } from "@agent-native/core/server";
import { defineEventHandler, getRequestHeader, getRequestURL, readBody } from "h3";

import { ensureAppUser, isSuspended } from "@domain/auth";
import { isActionError } from "@domain/lib/action-result";
import { parseBuilderSignRequest, readBuilderCredentials, signBuilderRequest } from "@domain/polymarket/trading";
import { enforceRateLimit } from "@domain/rate-limit";

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

const STATUS_FOR: Record<string, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SUSPENDED: 423,
  RATE_LIMITED: 429,
};

export default defineEventHandler(async (event) => {
  const origin = getRequestHeader(event, "origin");
  // Behind a proxy (Netlify) the public origin arrives as X-Forwarded-Host/Proto; a cross-site page can't set
  // those on a credentialed request without a CORS preflight we never grant.
  const ownOrigins = [
    getRequestURL(event).origin,
    getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin,
  ];
  if (origin && !ownOrigins.includes(origin)) return fail(403, "Cross-site signing requests are not allowed.");

  const session = await getSession(event);
  if (!session?.email) return fail(401, "Sign in to place a bet.");
  const user = await ensureAppUser(session.email);
  if (user === "needs-handle") return fail(401, "Finish setting up your ARGUE IT profile first.");
  if (isSuspended(user)) return fail(423, "Your account is suspended.");
  if (!readBuilderCredentials()) return fail(403, "Betting isn't switched on for this app yet.");

  try {
    // Before parsing, so refused requests count too: otherwise a signed-in user could flood the logs with
    // the warn line below. Inside the try so RATE_LIMITED maps to 429.
    await enforceRateLimit(user.id, "polymarket_sign");
    const body = await readBody(event);
    const request = parseBuilderSignRequest(body);
    if (!request) {
      // Path only (never the body): shows if a newer SDK starts signing a relayer call we don't allow yet.
      const path = (body as { path?: unknown } | null)?.path;
      console.warn("[builder-sign] refused", typeof path === "string" ? path.slice(0, 120) : "(no path)");
      return fail(400, "That signing request isn't allowed.");
    }
    if (request.method === "POST") await enforceRateLimit(user.id, "polymarket_relay");
    const headers = await signBuilderRequest(request);
    return Response.json(headers, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (isActionError(error)) return fail(STATUS_FOR[error.code] ?? 500, error.message);
    return fail(500, "Couldn't sign that request. Please try again.");
  }
});
