/**
 * Buy Yes / Buy No panel for one market option, like Polymarket's own order ticket.
 *
 * Real money, so every step is explicit: connect wallet → Polymarket's location check → amount → a
 * confirmation that restates option, side, price and the all-in cap → the user's wallet signs. Nothing is
 * placed without that final click and the wallet's own signature prompt. See app/lib/polymarket-trading.ts
 * for why the order goes from this browser and never from our server.
 */
import { CheckCircle2, ExternalLink, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/argue/ui/button";
import { Card } from "@/components/argue/ui/card";
import {
  checkGeoblock,
  connectTrading,
  fetchCashBalance,
  hasInjectedWallet,
  logTradeError,
  MAX_PRICE_SLIPPAGE,
  placeBet,
  TradeError,
  watchWallet,
  type GeoStatus,
  type PlacedBet,
  type TradingSession,
} from "@/lib/polymarket-trading";
import { cn } from "@domain/lib/cn";
import type { MarketOutcome } from "@domain/polymarket/markets";

import { formatCents, formatUsd } from "./format";

const QUICK_AMOUNTS = [1, 5, 10, 100] as const;
const MAX_BET_USD = 10_000;

export type TradeSide = "yes" | "no";

export interface TradePanelProps {
  eventTitle: string;
  eventUrl: string;
  outcome: MarketOutcome | null;
  side: TradeSide;
  onSideChange: (side: TradeSide) => void;
  trading: { enabled: boolean; builderCode: string | null };
}

type Phase =
  | { name: "idle" }
  | { name: "connecting" }
  | { name: "ready" }
  | { name: "confirm" }
  | { name: "placing" }
  | { name: "done"; bet: PlacedBet };

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function doneMessage(bet: PlacedBet): string {
  // A delayed order is queued by Polymarket and may still fill, so never tell the user nothing was spent.
  if (bet.status === "delayed") {
    return "Order queued by Polymarket. Check your Polymarket activity to see whether it filled.";
  }
  if (bet.status === "matched" && bet.shares > 0) {
    return `Bet placed: ${bet.shares.toFixed(2)} shares for ${formatUsd(bet.spent)}.`;
  }
  return "Order sent, but nothing matched at that price, so nothing was spent.";
}

export function TradePanel({ eventTitle, eventUrl, outcome, side, onSideChange, trading }: TradePanelProps) {
  const [session, setSession] = useState<TradingSession | null>(null);
  const [geo, setGeo] = useState<GeoStatus | null>(null);
  const [cash, setCash] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);

  // A new option or side resets a pending confirmation, so the user never confirms something they didn't see.
  useEffect(() => {
    setPhase((p) => (p.name === "confirm" || p.name === "done" ? { name: session ? "ready" : "idle" } : p));
  }, [outcome?.marketId, side, session]);

  // A wallet that switches account or leaves Polygon no longer matches the session: drop it so the user
  // reconnects, rather than signing with the wrong account or chain.
  useEffect(() => {
    if (!session) return;
    return watchWallet(session.signer, () => {
      setSession(null);
      setCash(null);
      setPhase((p) => (p.name === "placing" ? p : { name: "idle" }));
      setError("Your wallet changed account or network. Reconnect to bet.");
    });
  }, [session]);

  const price = side === "yes" ? outcome?.yesPrice : outcome?.noPrice;
  const hasPrice = typeof price === "number" && Number.isFinite(price) && price > 0;
  const maxPrice = hasPrice ? Math.min(1, price + MAX_PRICE_SLIPPAGE) : null;
  const amountUsd = Number(amount);
  const validAmount = Number.isFinite(amountUsd) && amountUsd > 0 && amountUsd <= MAX_BET_USD;
  const estShares = validAmount && price ? amountUsd / price : null;
  const canTrade = trading.enabled && !!trading.builderCode && !!outcome?.acceptingOrders;

  async function connect() {
    setError(null);
    setPhase({ name: "connecting" });
    try {
      const status = await checkGeoblock();
      setGeo(status);
      if (status.blocked) {
        setPhase({ name: "idle" });
        return;
      }
      const next = await connectTrading();
      setSession(next);
      setCash(await fetchCashBalance(next));
      setPhase({ name: "ready" });
    } catch (e) {
      // TradeErrors were already logged with their cause in polymarket-trading.ts.
      if (!(e instanceof TradeError)) logTradeError("connect", e);
      setError(e instanceof TradeError ? e.message : "Couldn't connect to Polymarket. Please try again.");
      setPhase({ name: "idle" });
    }
  }

  async function submit() {
    if (!session || !outcome || !trading.builderCode || !validAmount || !hasPrice) return;
    setError(null);
    setPhase({ name: "placing" });
    try {
      const bet = await placeBet(session, {
        marketId: outcome.marketId,
        side,
        amountUsd,
        displayedPrice: price,
        builderCode: trading.builderCode,
        negRisk: outcome.negRisk,
      });
      setPhase({ name: "done", bet });
      setAmount("");
      setCash(await fetchCashBalance(session));
    } catch (e) {
      if (!(e instanceof TradeError)) logTradeError("place bet", e);
      setError(e instanceof TradeError ? e.message : "Couldn't place the bet.");
      setPhase({ name: "ready" });
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        {outcome?.image ? (
          <img src={outcome.image} alt="" className="size-11 shrink-0 rounded-[var(--radius-sm)] object-cover" />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-3">{eventTitle}</p>
          <p className="font-semibold text-ink">
            {outcome?.label ?? "Pick an option"}{" "}
            <span className={side === "yes" ? "text-for" : "text-against"}>· {side === "yes" ? "Yes" : "No"}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Side">
        {(["yes", "no"] as const).map((s) => {
          const p = s === "yes" ? outcome?.yesPrice : outcome?.noPrice;
          const active = side === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => onSideChange(s)}
              className={cn(
                "h-12 rounded-[var(--radius)] text-base font-semibold transition-colors",
                active
                  ? s === "yes"
                    ? "bg-for text-on-for"
                    : "bg-against text-on-against"
                  : "border border-line-strong bg-surface text-ink-2 hover:bg-surface-2",
              )}
            >
              {s === "yes" ? "Yes" : "No"} {formatCents(p)}
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor="bet-amount" className="flex items-center justify-between text-sm font-semibold text-ink">
          Amount
          {cash !== null ? <span className="font-normal text-ink-3">Cash {formatUsd(cash)}</span> : null}
        </label>
        <div className="mt-1 flex items-center rounded-[var(--radius)] border border-line-strong bg-surface px-3 focus-within:ring-2 focus-within:ring-focus">
          <span className="text-2xl text-ink-3">$</span>
          <input
            id="bet-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "").slice(0, 9))}
            className="h-14 w-full bg-transparent text-right text-3xl font-semibold text-ink outline-none"
          />
        </div>
        <div className="mt-2 flex justify-end gap-1.5">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount((a) => String(Math.min(MAX_BET_USD, (Number(a) || 0) + v)))}
              className="rounded-[var(--radius-sm)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2 hover:text-ink"
            >
              +${v}
            </button>
          ))}
        </div>
        {estShares !== null ? (
          <p className="mt-2 text-sm text-ink-3">
            ≈ {estShares.toFixed(2)} shares · pays {formatUsd(estShares)} if {side === "yes" ? "Yes" : "No"} wins
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-danger-soft px-3 py-2 text-sm text-ink">
          {error}
        </p>
      ) : null}

      {geo && !geo.checked ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-warning-soft px-3 py-2 text-sm text-ink">
          Couldn't check your location with Polymarket, which it requires before any bet. Try again.
        </p>
      ) : geo?.blocked ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-warning-soft px-3 py-2 text-sm text-ink">
          Polymarket doesn't allow new bets from your location
          {geo.country ? ` (${geo.country}${geo.region ? `-${geo.region}` : ""})` : ""}, so betting is off here.
        </p>
      ) : null}

      {!canTrade ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-2">
            {trading.enabled
              ? "This option isn't taking orders right now."
              : "In-app betting isn't switched on yet. You can still trade this market on Polymarket."}
          </p>
          <a
            href={eventUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-2"
          >
            Open on Polymarket <ExternalLink aria-hidden className="size-4" />
          </a>
        </div>
      ) : !session ? (
        <Button
          size="lg"
          fullWidth
          loading={phase.name === "connecting"}
          disabled={geo?.checked === true && geo.blocked}
          icon={<Wallet aria-hidden className="size-4" />}
          onClick={connect}
        >
          {hasInjectedWallet() ? "Connect wallet to bet" : "Connect a wallet to bet"}
        </Button>
      ) : phase.name === "confirm" || phase.name === "placing" ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-line-strong p-3">
          <p className="text-sm text-ink">
            Buy <strong>{side === "yes" ? "Yes" : "No"}</strong> on <strong>{outcome?.label}</strong> for up to{" "}
            <strong>{formatUsd(amountUsd)}</strong> (fees included) at about {formatCents(price)} a share, and at
            most <strong>{formatCents(maxPrice)}</strong> a share. If the price has moved higher, nothing is placed.
          </p>
          <p className="text-xs text-ink-3">
            Fills right away at the best available prices; anything that can't fill is cancelled. Your wallet will ask
            you to sign.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth disabled={phase.name === "placing"} onClick={() => setPhase({ name: "ready" })}>
              Back
            </Button>
            <Button fullWidth loading={phase.name === "placing"} disabled={!hasPrice} onClick={submit}>
              Confirm bet
            </Button>
          </div>
        </div>
      ) : (
        <Button size="lg" fullWidth disabled={!validAmount || !hasPrice} onClick={() => setPhase({ name: "confirm" })}>
          {validAmount ? `Bet ${formatUsd(amountUsd)}` : "Enter an amount"}
        </Button>
      )}

      {phase.name === "done" ? (
        <div role="status" className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-success-soft px-3 py-2 text-sm text-ink">
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <span>{doneMessage(phase.bet)}</span>
        </div>
      ) : null}

      {session ? (
        <p className="text-xs text-ink-3">
          Polymarket wallet {shortAddress(session.wallet)} · signer {shortAddress(session.signer)}.{" "}
          {cash === 0 ? (
            <>
              It holds no pUSD yet:{" "}
              <a
                href="https://docs.polymarket.com/trading/bridge/deposit"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                how to fund it
              </a>
              .
            </>
          ) : null}
        </p>
      ) : null}

      <p className="text-center text-xs text-ink-3">
        Bets are placed on Polymarket with your own wallet. By trading you agree to Polymarket's{" "}
        <a href="https://polymarket.com/tos" target="_blank" rel="noopener noreferrer" className="underline">
          Terms of Use
        </a>
        . ARGUE IT never holds your funds.
      </p>
    </Card>
  );
}
