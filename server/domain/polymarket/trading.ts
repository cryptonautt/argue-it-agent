/**
 * Builder Program plumbing for in-app Polymarket trading.
 *
 * Trading is non-custodial: the user's own browser wallet signs every order, and ARGUE IT never sees a
 * private key or holds funds. The server owns only the app's Builder credentials, which are deployment
 * secrets (secrets skill, rule 4: owned by the deployed app, not by a user):
 *
 *   POLYMARKET_BUILDER_CODE        public; attached to every order so volume and builder fees are credited
 *   POLYMARKET_BUILDER_API_KEY     secret; with SECRET and PASSPHRASE, signs Builder-authenticated
 *   POLYMARKET_BUILDER_SECRET        relayer requests (Deposit Wallet deployment, gasless approvals)
 *   POLYMARKET_BUILDER_PASSPHRASE    through Remote Builder Signing; never sent to the browser
 *
 * Trading stays off unless all four are set. See docs.polymarket.com/trading/wallets-auth.md
 * ("Remote Builder Signing") and /programs/builders/overview.md.
 */
import { buildHmacSignature } from "@polymarket/client";
import { z } from "zod";

import { ActionError } from "@domain/lib/action-result";

export interface BuilderCredentials {
  code: string;
  key: string;
  secret: string;
  passphrase: string;
}

export interface TradingStatus {
  enabled: boolean;
  /** Public builder code to attach to orders; null while trading is off. */
  builderCode: string | null;
}

export function readBuilderCredentials(): BuilderCredentials | null {
  // App-owned deployment secrets for ARGUE IT's own builder account, not a user's credential (secrets skill, rule 4).
  const creds = {
    code: process.env.POLYMARKET_BUILDER_CODE?.trim() ?? "", // guard:allow-env-credential — app-owned builder code (public)
    key: process.env.POLYMARKET_BUILDER_API_KEY?.trim() ?? "", // guard:allow-env-credential — app-owned deployment secret
    secret: process.env.POLYMARKET_BUILDER_SECRET?.trim() ?? "", // guard:allow-env-credential — app-owned deployment secret
    passphrase: process.env.POLYMARKET_BUILDER_PASSPHRASE?.trim() ?? "", // guard:allow-env-credential — app-owned deployment secret
  };
  return creds.code && creds.key && creds.secret && creds.passphrase ? creds : null;
}

export function tradingStatus(): TradingStatus {
  const creds = readBuilderCredentials();
  return creds ? { enabled: true, builderCode: creds.code } : { enabled: false, builderCode: null };
}

/** What the SDK's `remoteBuilderSigning` posts: the request it is about to send to Polymarket. */
export const builderSignRequestSchema = z.object({
  method: z
    .string()
    .transform((m) => m.toUpperCase())
    .pipe(z.enum(["GET", "POST", "DELETE"])),
  // A root-relative Polymarket API path with an optional query string; no scheme, host or traversal.
  path: z
    .string()
    .max(300)
    .regex(/^\/[A-Za-z0-9/_\-.~%]*(\?[A-Za-z0-9_\-.~%=&,]*)?$/)
    .refine((p) => !p.includes(".."), "bad path"),
  body: z.string().max(100_000).nullish(),
});

export type BuilderSignRequest = z.infer<typeof builderSignRequestSchema>;

/**
 * The relayer calls the SDK makes with Builder auth for deploying a Deposit Wallet, gasless approvals and
 * polling them (@polymarket/client 0.14: `/deployed`, `/v1/account/transactions/...`, `/submit`). Anything
 * else is refused, so a signed-in user can't spend the app's relayer quota on unrelated operations.
 */
const ALLOWED_RELAYER_CALLS: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "GET", path: /^\/deployed(\?|$)/ },
  { method: "GET", path: /^\/v1\/account\/transactions\/[A-Za-z0-9_-]+(\?|$)/ },
  { method: "POST", path: /^\/submit$/ },
];

export function isAllowedRelayerCall(method: string, path: string): boolean {
  return ALLOWED_RELAYER_CALLS.some((call) => call.method === method && call.path.test(path));
}

/** Parse what the SDK posts; null when it isn't a well-formed, allowed relayer call. */
export function parseBuilderSignRequest(input: unknown): BuilderSignRequest | null {
  const parsed = builderSignRequestSchema.safeParse(input);
  if (!parsed.success || !isAllowedRelayerCall(parsed.data.method, parsed.data.path)) return null;
  return parsed.data;
}

export interface BuilderHeaders {
  POLY_BUILDER_API_KEY: string;
  POLY_BUILDER_PASSPHRASE: string;
  POLY_BUILDER_SIGNATURE: string;
  POLY_BUILDER_TIMESTAMP: string;
}

export async function signBuilderRequest(input: unknown, at: Date = new Date()): Promise<BuilderHeaders> {
  const creds = readBuilderCredentials();
  if (!creds) throw new ActionError("FORBIDDEN", "Betting isn't switched on for this app yet.");
  const parsed = parseBuilderSignRequest(input);
  if (!parsed) throw new ActionError("VALIDATION", "That signing request isn't valid.");
  const { method, path, body } = parsed;
  const timestamp = Math.floor(at.getTime() / 1000);
  return {
    POLY_BUILDER_API_KEY: creds.key,
    POLY_BUILDER_PASSPHRASE: creds.passphrase,
    POLY_BUILDER_SIGNATURE: await buildHmacSignature(creds.secret, timestamp, method, path, body ?? undefined),
    POLY_BUILDER_TIMESTAMP: String(timestamp),
  };
}
