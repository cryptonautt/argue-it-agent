import { afterEach, describe, expect, it } from "vitest";
import {
  HOUR_MS,
  MINUTE_MS,
  addHours,
  advanceClock,
  formatCountdown,
  formatRelative,
  isPast,
  msUntil,
  now,
  resetClock,
  setClock,
} from "./time";

afterEach(() => resetClock());

describe("clock", () => {
  it("can be frozen and advanced", () => {
    const start = new Date("2026-10-31T12:00:00Z");
    setClock(start);
    expect(now().toISOString()).toBe(start.toISOString());
    advanceClock(HOUR_MS);
    expect(now().toISOString()).toBe("2026-10-31T13:00:00.000Z");
  });

  it("returns fresh Date objects (callers cannot mutate the clock)", () => {
    setClock(new Date("2026-01-01T00:00:00Z"));
    now().setFullYear(1999);
    expect(now().getUTCFullYear()).toBe(2026);
  });
});

describe("deadlines", () => {
  it("treats the exact deadline instant as past", () => {
    const deadline = new Date("2026-10-31T12:00:00Z");
    expect(isPast(deadline, deadline)).toBe(true);
    expect(isPast(deadline, new Date(deadline.getTime() - 1))).toBe(false);
  });

  it("msUntil and addHours", () => {
    const at = new Date("2026-10-31T00:00:00Z");
    expect(msUntil(addHours(at, 24), at)).toBe(24 * HOUR_MS);
  });
});

describe("formatCountdown", () => {
  it.each([
    [0, "0s"],
    [-5, "0s"],
    [42_000, "42s"],
    [4 * MINUTE_MS + 9_000, "4m 09s"],
    [3 * HOUR_MS + 12 * MINUTE_MS, "3h 12m"],
    [52 * HOUR_MS, "2d 4h"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe("formatRelative", () => {
  const ref = new Date("2026-10-31T12:00:00Z");
  it.each([
    ["2026-10-31T11:59:30Z", "just now"],
    ["2026-10-31T11:55:00Z", "5m ago"],
    ["2026-10-31T09:00:00Z", "3h ago"],
    ["2026-10-29T12:00:00Z", "2d ago"],
    ["2026-10-01T12:00:00Z", "1 Oct 2026"],
  ])("%s → %s", (iso, text) => {
    expect(formatRelative(iso, ref)).toBe(text);
  });
});
