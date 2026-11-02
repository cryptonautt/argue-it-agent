/**
 * Time helpers. Server timestamps are authoritative (design §4.2): server code MUST read the current
 * time through `now()` so tests can move the clock with `setClock()` / `advanceClock()`.
 * All dates are UTC instants; format for display only at the edge.
 */
import { differenceInSeconds, formatDistanceStrict } from "date-fns";

let clock: () => Date = () => new Date();

/** The current time. Use this instead of `new Date()` / `Date.now()` in domain logic. */
export function now(): Date {
  return clock();
}

/** Test-only: freeze the clock at `date` (or install a custom clock function). */
export function setClock(date: Date | (() => Date)): void {
  if (typeof date === "function") {
    clock = date;
    return;
  }
  const frozen = date.getTime();
  clock = () => new Date(frozen);
}

/** Test-only: move the clock forward by `ms` (freezes it at the new instant). */
export function advanceClock(ms: number): void {
  const next = clock().getTime() + ms;
  clock = () => new Date(next);
}

/** Test-only: restore the real clock. */
export function resetClock(): void {
  clock = () => new Date();
}

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addHours(date: Date, hours: number): Date {
  return addMs(date, hours * HOUR_MS);
}

/** True when `deadline` is at or before `ref` (default: now()). Deadlines are exclusive. */
export function isPast(deadline: Date, ref: Date = now()): boolean {
  return deadline.getTime() <= ref.getTime();
}

/** Milliseconds until `deadline` (negative if past). */
export function msUntil(deadline: Date, ref: Date = now()): number {
  return deadline.getTime() - ref.getTime();
}

/** Accepts Date | ISO string | epoch ms (e.g. values serialised across the server/client boundary). */
export function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Compact countdown: "2d 4h", "3h 12m", "4m 09s", "0s". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / SECOND_MS);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date like "4 Oct 2026". */
export function formatRelative(value: Date | string | number, ref: Date = now()): string {
  const date = toDate(value);
  const seconds = differenceInSeconds(ref, date);
  if (seconds < 45) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Long form for tooltips/screen readers: "in 3 hours" / "3 hours ago". */
export function formatDistance(value: Date | string | number, ref: Date = now()): string {
  return formatDistanceStrict(toDate(value), ref, { addSuffix: true });
}

/** Absolute date-time, e.g. "31 Oct 2026, 14:05". Pass a timeZone on the server; omit in the browser. */
export function formatDateTime(value: Date | string | number, timeZone?: string): string {
  return toDate(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}
