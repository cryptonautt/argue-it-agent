/**
 * In-browser Polymarket trading for the market trade panel.
 *
 * Non-custodial by construction: the user's own injected wallet (MetaMask, Rabby, ...) signs the CLOB
 * login and every order, and orders go from this browser straight to Polymarket. ARGUE IT never sees a
 * private key or holds funds. Our server only signs Builder headers for relayer calls (Deposit Wallet
 * deployment, gasless approvals) through `/api/polymarket/builder-sign`, and our public builder code is
 * attached to each order so the volume is credited to ARGUE IT's builder profile.
 *
 * Orders are sent from the browser on purpose: Polymarket geoblocks by the requesting IP, so the check and
 * the order must both come from the user's own connection, never from our server.
 *
 * The SDK and viem are imported lazily: they are large and only needed once someone opens the trade panel.
 */
import { appPath } from "@agent-native/core/client/api-path";
import type { OrderPostStatus, SecureClient } from "@polymarket/client";

const GEOBLOCK_URL = "https://polymarket.com/api/geoblock";
const BUILDER_SIGN_PATH = "/api/polymarket/builder-sign";

// CTF negative-risk contracts (docs.polymarket.com/trading/wallets-auth.md, "Set Up Trading Approvals").
const PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const CONDITIONAL_TOKENS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
const PUSD_DECIMALS = 6;
const POLYGON_CHAIN_ID = 137;

/**
 * How far (in price, 0–1) the live order book may sit above the price the user confirmed before we refuse to
 * place. The confirm step shows the Gamma price, which can be up to 15 s old.
 */
export const MAX_PRICE_SLIPPAGE = 0.05;

interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/** A user-facing failure; `message` is safe to show as-is. */
export class TradeError extends Error {
  constructor(
    message: string,
    readonly kind: "no-wallet" | "rejected" | "blocked" | "funds" | "market" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "TradeError";
  }
}

export interface GeoStatus {
  /** False when Polymarket's answer couldn't be read (network, CSP); `blocked` is then true. */
  checked: boolean;
  blocked: boolean;
  country: string | null;
  region: string | null;
}

export interface TradingSession {
  client: SecureClient;
  /** The account wallet that holds pUSD and positions (the user's Polymarket Deposit Wallet). */
  wallet: string;
  /** The user's own signing address. */
  signer: string;
}

export interface PlaceBetInput {
  marketId: string;
  side: "yes" | "no";
  /** All-in USD to spend, fees included. */
  amountUsd: number;
  /** Per-share price (0–1) shown on the confirm step. The live estimate may exceed it by MAX_PRICE_SLIPPAGE. */
  displayedPrice: number;
  builderCode: string;
  negRisk: boolean;
}

/**
 * `matched`: filled (fully or partly) at placement. `delayed`: Polymarket queued the order behind a matching
 * delay, so it may still fill. `live` or `unmatched`: a fill-and-kill order that found nothing to match.
 */
export type PlacedBetStatus = `${OrderPostStatus}` | "unmatched";

export interface PlacedBet {
  /** Empty when Polymarket refused the order as unmatched. */
  orderId: string;
  status: PlacedBetStatus;
  /** pUSD actually spent at placement (0 when nothing matched). */
  spent: number;
  /** Shares received at placement. */
  shares: number;
}

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && typeof window.ethereum?.request === "function";
}

/** Polymarket's own check of the browser's IP. Fails closed: an unreadable answer counts as blocked. */
export async function checkGeoblock(): Promise<GeoStatus> {
  try {
    const response = await fetch(GEOBLOCK_URL, { credentials: "omit" });
    const body = (await response.json()) as Partial<{ blocked: boolean; country: string; region: string }>;
    if (typeof body.blocked !== "boolean") return { checked: false, blocked: true, country: null, region: null };
    return {
      checked: true,
      blocked: body.blocked,
      country: typeof body.country === "string" ? body.country : null,
      region: typeof body.region === "string" ? body.region : null,
    };
  } catch {
    return { checked: false, blocked: true, country: null, region: null };
  }
}

function isUserRejection(error: unknown): boolean {
  const e = error as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown } | null;
  if (!e) return false;
  if (e.code === 4001 || e.name === "UserRejectedRequestError" || e.name === "CancelledSigningError") return true;
  if (typeof e.message === "string" && /user (rejected|denied)|rejected the request/i.test(e.message)) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

function hasErrorName(error: unknown, name: string, depth = 0): boolean {
  const e = error as { name?: unknown; cause?: unknown } | null;
  if (!e || depth > 5) return false;
  if (e.name === name) return true;
  return e.cause ? hasErrorName(e.cause, name, depth + 1) : false;
}

/**
 * A console-safe summary of an error and its causes. SDK errors can wrap raw HTTP errors whose `request`
 * carries the user's CLOB auth headers, so we never log the object itself: only names, messages, codes and
 * statuses.
 */
function describeError(error: unknown, depth = 0): Record<string, unknown> | string {
  if (error === null || typeof error !== "object") return String(error);
  const e = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
    restriction?: unknown;
    retryAfter?: unknown;
    stack?: unknown;
    cause?: unknown;
  };
  const out: Record<string, unknown> = {};
  if (typeof e.name === "string") out.name = e.name;
  if (typeof e.message === "string") out.message = e.message.slice(0, 500);
  if (typeof e.code === "string" || typeof e.code === "number") out.code = e.code;
  if (typeof e.status === "number") out.status = e.status;
  if (typeof e.restriction === "string") out.restriction = e.restriction;
  if (typeof e.retryAfter === "number") out.retryAfter = e.retryAfter;
  if (depth === 0 && typeof e.stack === "string") out.stack = e.stack;
  if (e.cause !== undefined && depth < 4) out.cause = describeError(e.cause, depth + 1);
  return out;
}

/** Logs the real cause to the browser console, so a generic user-facing message can't hide a bug. */
export function logTradeError(context: string, error: unknown): void {
  console.error("[polymarket]", context, describeError(error));
}

const FUNDS_MESSAGE = "Your Polymarket wallet doesn't have enough pUSD for this bet (fees included).";
const LIQUIDITY_MESSAGE = "There isn't enough on the order book to fill that right now. Try a smaller amount.";

function toTradeError(error: unknown, fallback: string): TradeError {
  if (error instanceof TradeError) return error;
  logTradeError(fallback, error);
  if (isUserRejection(error)) return new TradeError("You cancelled the request in your wallet.", "rejected");
  // By name, before the funds check: a liquidity error's message can mention "insufficient".
  if (hasErrorName(error, "InsufficientLiquidityError")) return new TradeError(LIQUIDITY_MESSAGE, "market");
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string" && /not enough balance|insufficient (pusd |collateral )?balance/i.test(message)) {
    return new TradeError(FUNDS_MESSAGE, "funds");
  }
  return new TradeError(fallback);
}

/**
 * Calls `onChange` when the wallet switches to an account other than `signer`, or leaves Polygon, so the panel
 * can drop a session that no longer matches the wallet. Returns an unsubscribe function.
 */
export function watchWallet(signer: string, onChange: () => void): () => void {
  const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!ethereum?.on || !ethereum.removeListener) return () => {};
  // Some wallets re-emit the same account (e.g. on unlock) or the same chain; only a real change counts.
  const onAccounts = (accounts: unknown) => {
    const first = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
    if (first.toLowerCase() !== signer.toLowerCase()) onChange();
  };
  const onChain = (chainId: unknown) => {
    if (typeof chainId !== "string" || Number.parseInt(chainId, 16) !== POLYGON_CHAIN_ID) onChange();
  };
  ethereum.on("accountsChanged", onAccounts);
  ethereum.on("chainChanged", onChain);
  return () => {
    ethereum.removeListener?.("accountsChanged", onAccounts);
    ethereum.removeListener?.("chainChanged", onChain);
  };
}

async function assertOnPolygon(): Promise<void> {
  const chainId = await window.ethereum?.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || Number.parseInt(chainId, 16) !== POLYGON_CHAIN_ID) {
    throw new TradeError("Your wallet isn't on Polygon any more. Reconnect your wallet to bet.", "no-wallet");
  }
}

/**
 * Connect the injected wallet on Polygon and open a Polymarket session. The wallet asks the user to sign
 * Polymarket's login message; the first time, Polymarket also deploys the user's Deposit Wallet (gasless).
 */
export async function connectTrading(): Promise<TradingSession> {
  const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!ethereum) {
    throw new TradeError("Install a browser wallet such as MetaMask or Rabby to bet.", "no-wallet");
  }
  try {
    const [{ createWalletClient, custom }, { polygon }, sdk, sdkViem] = await Promise.all([
      import("viem"),
      import("viem/chains"),
      import("@polymarket/client"),
      import("@polymarket/client/viem"),
    ]);
    const transport = custom(ethereum);
    const [address] = await createWalletClient({ chain: polygon, transport }).requestAddresses();
    if (!address) throw new TradeError("Your wallet didn't share an account.", "no-wallet");
    const walletClient = createWalletClient({ account: address, chain: polygon, transport });
    try {
      await walletClient.switchChain({ id: polygon.id });
    } catch (error) {
      if (isUserRejection(error)) throw error;
      await walletClient.addChain({ chain: polygon });
      await walletClient.switchChain({ id: polygon.id });
    }
    const client = await sdk.createSecureClient({
      signer: sdkViem.signerFrom(walletClient),
      apiKey: sdk.remoteBuilderSigning({ url: appPath(BUILDER_SIGN_PATH), credentials: "include" }),
    });
    return { client, wallet: client.account.wallet, signer: client.account.signer };
  } catch (error) {
    throw toTradeError(error, "Couldn't connect to Polymarket. Please try again.");
  }
}

/** pUSD available in the account wallet, in dollars. */
export async function fetchCashBalance(session: TradingSession): Promise<number | null> {
  try {
    const [{ fetchBalanceAllowance }, { AssetType }] = await Promise.all([
      import("@polymarket/client/actions"),
      import("@polymarket/client"),
    ]);
    const result = await fetchBalanceAllowance(session.client, { assetType: AssetType.COLLATERAL });
    return Number(result.balance) / 10 ** PUSD_DECIMALS;
  } catch (error) {
    logTradeError("Couldn't read the cash balance.", error);
    return null;
  }
}

function negRiskApprovalKey(wallet: string): string {
  return `argue.polymarket.approved.negrisk.${wallet.toLowerCase()}`;
}

function rememberApproved(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {}
}

function wasApproved(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function forgetApproved(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

/** Whether the SDK's standard trading approvals are all in place, read from chain. Null when it can't tell. */
async function standardApprovalsDone(session: TradingSession): Promise<boolean | null> {
  try {
    return (await session.client.fetchTradingApprovalsState()).isFullyApproved;
  } catch (error) {
    logTradeError("Couldn't read the trading approvals state.", error);
    return null;
  }
}

/**
 * Gasless approvals so Polymarket's exchange can move the wallet's pUSD and outcome tokens.
 * - Standard approvals come from the SDK's real approval state. `setupTradingApprovals()` runs only when
 *   something is missing, or when the state can't be read (setup re-checks on its own).
 * - Multi-outcome ("negative risk") CTF markets also need the Neg Risk Adapter approvals, which that state
 *   doesn't cover. They're remembered in localStorage, and `placeBet` clears the flag whenever an order
 *   fails, so a retry re-approves.
 */
async function ensureApprovals(session: TradingSession, negRisk: boolean, version: string | undefined): Promise<void> {
  if ((await standardApprovalsDone(session)) !== true) {
    await session.client.setupTradingApprovals();
  }
  if (!negRisk || version === "v2") return;
  const negKey = negRiskApprovalKey(session.wallet);
  if (wasApproved(negKey)) return;
  const collateral = await session.client.approveErc20({
    tokenAddress: PUSD,
    spenderAddress: NEG_RISK_ADAPTER,
    amount: "max",
  });
  await collateral.wait();
  const outcomes = await session.client.approveErc1155ForAll({
    tokenAddress: CONDITIONAL_TOKENS,
    operatorAddress: NEG_RISK_ADAPTER,
    approved: true,
  });
  await outcomes.wait();
  rememberApproved(negKey);
}

/** Estimated average price for spending `amountUsd` on one side, from the live order book. */
export async function estimatePrice(session: TradingSession, marketId: string, side: "yes" | "no", amountUsd: number) {
  const { OrderSide, OrderType } = await import("@polymarket/client");
  const assetId = await assetIdFor(session, marketId, side);
  return session.client.estimateMarketPrice({
    assetId: assetId.id,
    side: OrderSide.BUY,
    amount: String(amountUsd),
    orderType: OrderType.FAK,
  });
}

async function assetIdFor(session: TradingSession, marketId: string, side: "yes" | "no") {
  const market = await session.client.fetchMarket({ id: marketId });
  const outcome = side === "yes" ? market.outcomes.yes : market.outcomes.no;
  const id = market.version === "v2" ? outcome.positionId : outcome.tokenId;
  if (!id) throw new TradeError("This market isn't taking orders right now.", "market");
  return { id: String(id), version: market.version as string | undefined };
}

/**
 * Market BUY (fill-and-kill): fills what the book offers up to the estimated price and cancels the rest.
 * `maxSpend` caps the all-in cost, Polymarket and builder fees included, at the amount the user typed.
 * Refuses to place when the live price is more than MAX_PRICE_SLIPPAGE above the price the user confirmed.
 */
export async function placeBet(session: TradingSession, input: PlaceBetInput): Promise<PlacedBet> {
  if (!(input.amountUsd > 0)) throw new TradeError("Enter an amount to bet.", "market");
  if (!Number.isFinite(input.displayedPrice) || input.displayedPrice <= 0) {
    throw new TradeError("This option has no price right now.", "market");
  }
  const negKey = input.negRisk ? negRiskApprovalKey(session.wallet) : null;
  try {
    await assertOnPolygon();
    const { OrderSide, OrderType, OrderResponseErrorCode } = await import("@polymarket/client");
    const asset = await assetIdFor(session, input.marketId, input.side);
    const amount = input.amountUsd.toFixed(2);
    const maxPrice = await session.client.estimateMarketPrice({
      assetId: asset.id,
      side: OrderSide.BUY,
      amount,
      orderType: OrderType.FAK,
    });
    // Compared in tenths of a cent, so an exact 5¢ move isn't refused by floating-point noise.
    if (Math.round(maxPrice * 1000) > Math.round((input.displayedPrice + MAX_PRICE_SLIPPAGE) * 1000)) {
      throw new TradeError(
        `The price moved to about ${Math.round(maxPrice * 100)}¢ since you confirmed. Check it and try again.`,
        "market",
      );
    }
    await ensureApprovals(session, input.negRisk, asset.version);
    let response: Awaited<ReturnType<SecureClient["placeMarketOrder"]>>;
    try {
      response = await session.client.placeMarketOrder({
        assetId: asset.id,
        side: OrderSide.BUY,
        amount,
        maxSpend: amount,
        maxPrice,
        orderType: OrderType.FAK,
        builderCode: input.builderCode,
      });
    } catch (error) {
      // A cancelled signature or a thin book says nothing about approvals; clearing the flag there would cost
      // the retry two more approvals out of the user's 10 relayer transactions a day.
      const approvalsIrrelevant = isUserRejection(error) || hasErrorName(error, "InsufficientLiquidityError");
      if (negKey && !approvalsIrrelevant) forgetApproved(negKey);
      throw error;
    }
    if (!response.ok) {
      const { code, message } = response;
      if (code === OrderResponseErrorCode.FAK_NOT_FILLED || code === OrderResponseErrorCode.UNMATCHED) {
        return { orderId: "", status: "unmatched", spent: 0, shares: 0 };
      }
      if (negKey) forgetApproved(negKey);
      logTradeError("Polymarket refused the order.", { name: "RejectedOrderResponse", code, message });
      if (code === OrderResponseErrorCode.INSUFFICIENT_BALANCE_OR_ALLOWANCE) {
        throw new TradeError(
          "Polymarket says the wallet's pUSD balance or approval is too low for this bet (fees included). " +
            "Check your cash and try again.",
          "funds",
        );
      }
      throw new TradeError(`Polymarket didn't take the order: ${response.message}`, "market");
    }
    return {
      orderId: String(response.orderId),
      status: response.status,
      spent: Number(response.makingAmount) || 0,
      shares: Number(response.takingAmount) || 0,
    };
  } catch (error) {
    throw toTradeError(error, "Couldn't place the bet. Nothing was charged unless your wallet shows a trade.");
  }
}
