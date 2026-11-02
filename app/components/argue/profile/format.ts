/** Display formatting for profile numbers and dates (pure; server and client safe). */

const integer = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatRating(rating: number): string {
  return integer.format(Math.round(rating));
}

export function formatCount(n: number): string {
  return integer.format(n);
}

export function formatScore(score: number): string {
  return oneDecimal.format(score);
}

/** "October 2026" (UTC, so server and client agree). */
export function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "12 Oct 2026" (UTC). */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "4W · 2L · 1D" style record, plus an accessible long form. */
export function formatRecord(r: { wins: number; losses: number; draws: number }): { short: string; long: string } {
  const plural = (n: number, one: string, many: string) => `${integer.format(n)} ${n === 1 ? one : many}`;
  return {
    short: `${integer.format(r.wins)}W · ${integer.format(r.losses)}L · ${integer.format(r.draws)}D`,
    long: `${plural(r.wins, "win", "wins")}, ${plural(r.losses, "loss", "losses")}, ${plural(r.draws, "draw", "draws")}`,
  };
}
