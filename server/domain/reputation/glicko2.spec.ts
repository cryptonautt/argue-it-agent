import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLICKO2_CONFIG,
  computeNewVolatility,
  expectedScore,
  g,
  rate,
  rateHeadToHead,
  toGlicko2Scale,
  winProbability,
} from "./glicko2";

/**
 * Reference values from Glickman, "Example of the Glicko-2 system" (glicko.net/glicko/glicko2.pdf):
 * a 1500/200/0.06 player (τ = 0.5) beats a 1400/30 player and loses to 1550/100 and 1700/300.
 */
const PAPER_PLAYER = { rating: 1500, rd: 200, volatility: 0.06 };
const PAPER_GAMES = [
  { opponent: { rating: 1400, rd: 30 }, score: 1 },
  { opponent: { rating: 1550, rd: 100 }, score: 0 },
  { opponent: { rating: 1700, rd: 300 }, score: 0 },
] as const;

describe("Glicko-2 — Glickman's worked example", () => {
  it("converts to the Glicko-2 scale (Step 2)", () => {
    const p = toGlicko2Scale(PAPER_PLAYER);
    expect(p.mu).toBe(0);
    expect(p.phi).toBeCloseTo(1.1513, 4);
    const opponents = PAPER_GAMES.map((game) => toGlicko2Scale(game.opponent));
    expect(opponents.map((o) => o.mu)).toEqual([
      expect.closeTo(-0.5756, 4),
      expect.closeTo(0.2878, 4),
      expect.closeTo(1.1513, 4),
    ]);
    expect(opponents.map((o) => o.phi)).toEqual([
      expect.closeTo(0.1727, 4),
      expect.closeTo(0.5756, 4),
      expect.closeTo(1.727, 3),
    ]);
  });

  it("computes g(φ) and E for each opponent (Step 3)", () => {
    const opponents = PAPER_GAMES.map((game) => toGlicko2Scale(game.opponent));
    expect(opponents.map((o) => g(o.phi))).toEqual([
      expect.closeTo(0.9955, 4),
      expect.closeTo(0.9531, 4),
      expect.closeTo(0.7242, 4),
    ]);
    expect(opponents.map((o) => expectedScore(0, o.mu, o.phi))).toEqual([
      expect.closeTo(0.639, 3),
      expect.closeTo(0.432, 3),
      expect.closeTo(0.303, 3),
    ]);
  });

  it("finds the new volatility with the Illinois algorithm (Step 5)", () => {
    // Paper: v = 1.7785, Δ = −0.4834, φ = 1.1513 → σ' = 0.05999 (printed truncated; exact 0.0599960).
    const sigmaPrime = computeNewVolatility(-0.4834, 1.1513, 1.7785, 0.06, DEFAULT_GLICKO2_CONFIG);
    expect(sigmaPrime).toBeCloseTo(0.059996, 6);
    expect(sigmaPrime).toBeLessThan(0.06);
  });

  it("produces the paper's final rating 1464.06, RD 151.52, σ 0.05999 (Steps 2–8)", () => {
    const result = rate(PAPER_PLAYER, PAPER_GAMES);
    expect(result.rating).toBeCloseTo(1464.06, 1);
    expect(result.rd).toBeCloseTo(151.52, 1);
    expect(result.volatility).toBeCloseTo(0.059996, 6);
  });
});

describe("Glicko-2 — properties", () => {
  const fresh = { rating: 1500, rd: 350, volatility: 0.06 };

  it("is symmetric for two equal new players: winner gains what the loser drops", () => {
    const { a, b } = rateHeadToHead(fresh, fresh, 1);
    expect(a.rating).toBeGreaterThan(1500);
    expect(b.rating).toBeLessThan(1500);
    expect(a.rating - 1500).toBeCloseTo(1500 - b.rating, 9);
    expect(a.rd).toBeCloseTo(b.rd, 9);
    expect(a.rd).toBeLessThan(350);
  });

  it("leaves equal players' ratings unchanged on a draw but still reduces uncertainty", () => {
    const { a, b } = rateHeadToHead(fresh, fresh, 0.5);
    expect(a.rating).toBeCloseTo(1500, 9);
    expect(b.rating).toBeCloseTo(1500, 9);
    expect(a.rd).toBeLessThan(350);
  });

  it("rewards an upset more than an expected win", () => {
    const strong = { rating: 1800, rd: 80, volatility: 0.06 };
    const weak = { rating: 1400, rd: 80, volatility: 0.06 };
    const upset = rate(weak, [{ opponent: strong, score: 1 }]).rating - weak.rating;
    const expected = rate(strong, [{ opponent: weak, score: 1 }]).rating - strong.rating;
    expect(upset).toBeGreaterThan(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("applies a half-weight game (forfeit) as a smaller, same-direction change", () => {
    const full = rateHeadToHead(fresh, fresh, 1, 1);
    const half = rateHeadToHead(fresh, fresh, 1, 0.5);
    const fullGain = full.a.rating - 1500;
    const halfGain = half.a.rating - 1500;
    expect(halfGain).toBeGreaterThan(0);
    expect(halfGain).toBeLessThan(fullGain);
    // Less information → uncertainty shrinks less.
    expect(half.a.rd).toBeGreaterThan(full.a.rd);
    expect(half.b.rating).toBeGreaterThan(full.b.rating);
  });

  it("weight 1 is identical to the unweighted formula", () => {
    const weighted = rate(PAPER_PLAYER, PAPER_GAMES.map((game) => ({ ...game, weight: 1 })));
    expect(weighted).toEqual(rate(PAPER_PLAYER, PAPER_GAMES));
  });

  it("only inflates RD when a player has no games in the period", () => {
    const player = { rating: 1600, rd: 100, volatility: 0.06 };
    const result = rate(player, []);
    expect(result.rating).toBe(1600);
    expect(result.volatility).toBe(0.06);
    expect(result.rd).toBeCloseTo(Math.sqrt((100 / 173.7178) ** 2 + 0.06 ** 2) * 173.7178, 9);
  });

  it("never lets RD exceed the default ceiling", () => {
    const result = rate({ rating: 1500, rd: 350, volatility: 0.06 }, []);
    expect(result.rd).toBe(350);
  });

  it("gives expected-score probabilities that sum to 1 for equal uncertainty", () => {
    const a = { rating: 1700, rd: 120 };
    const b = { rating: 1500, rd: 120 };
    expect(winProbability(a, b) + winProbability(b, a)).toBeCloseTo(1, 9);
    expect(winProbability(a, b)).toBeGreaterThan(0.5);
  });

  it("rejects invalid input instead of producing NaN ratings", () => {
    expect(() => rate(fresh, [{ opponent: fresh, score: 2 }])).toThrow(RangeError);
    expect(() => rate(fresh, [{ opponent: fresh, score: 1, weight: 0 }])).toThrow(RangeError);
    expect(() => rate({ ...fresh, rd: Number.NaN }, [])).toThrow(RangeError);
    expect(() => rate({ ...fresh, volatility: 0 }, [])).toThrow(RangeError);
  });
});
