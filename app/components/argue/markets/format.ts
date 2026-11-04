/** Display helpers for Polymarket numbers (prices are probabilities 0..1). */

export function formatPercent(price: number | null | undefined): string {
  if (price === null || price === undefined) return "—";
  const pct = price * 100;
  if (pct > 0 && pct < 1) return "<1%";
  if (pct < 100 && pct > 99) return ">99%";
  return `${Math.round(pct)}%`;
}

export function formatCents(price: number | null | undefined): string {
  if (price === null || price === undefined) return "—";
  const cents = Math.round(price * 1000) / 10;
  return `${Number.isInteger(cents) ? cents : cents.toFixed(1)}¢`;
}

export function formatChange(change: number | null | undefined): { text: string; direction: "up" | "down" } | null {
  if (change === null || change === undefined) return null;
  const points = Math.round(change * 100);
  if (points === 0) return null;
  return { text: `${Math.abs(points)}%`, direction: points > 0 ? "up" : "down" };
}

export function formatUsd(value: number, options: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: options.compact ? 1 : 2,
    notation: options.compact ? "compact" : "standard",
  }).format(value);
}

export function formatMarketDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Chart series colours, in fixed order (an outcome keeps its slot while the data refreshes). Defined as
 * `--series-1..4` in global.css; validated for CVD separation on both the light and dark surfaces.
 */
export const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"] as const;
