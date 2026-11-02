/**
 * Glicko-2 rating system — a pure, dependency-free implementation of
 * Mark E. Glickman, "Example of the Glicko-2 system" (2013, http://www.glicko.net/glicko/glicko2.pdf).
 *
 * Step numbers in the comments refer to that paper. Ratings are exposed on the familiar Glicko scale
 * (1500 / 350); internally everything is converted to the Glicko-2 scale (μ, φ) as in Step 2.
 *
 * ARGUE IT extension — weighted games: each game result may carry a weight w ∈ (0, 1]. The variance and
 * improvement sums (Steps 3 and 4) multiply each game's contribution by w, so a half-weight game
 * (a forfeit, design §4.5) carries half the information of a judged debate. With every w = 1 the
 * formulas are exactly Glickman's.
 */

/** Conversion constant between the Glicko and Glicko-2 scales (Step 2). */
export const GLICKO2_SCALE = 173.7178;

export interface Glicko2Config {
  /** System constant τ — constrains volatility change. Glickman suggests 0.3–1.2. */
  tau: number;
  /** Convergence tolerance for the volatility iteration (Step 5). */
  epsilon: number;
  /** Rating assigned to unrated players. */
  defaultRating: number;
  /** RD assigned to unrated players; also the ceiling RD can never exceed. */
  defaultRd: number;
  /** Volatility assigned to unrated players. */
  defaultVolatility: number;
  /** RD floor so long-time players can still move (Glicko-2 itself has no floor). */
  minRd: number;
}

export const DEFAULT_GLICKO2_CONFIG: Readonly<Glicko2Config> = Object.freeze({
  tau: 0.5,
  epsilon: 0.000001,
  defaultRating: 1500,
  defaultRd: 350,
  defaultVolatility: 0.06,
  minRd: 30,
});

export interface Glicko2Rating {
  /** Glicko scale, e.g. 1500. */
  rating: number;
  /** Rating deviation on the Glicko scale, e.g. 350. */
  rd: number;
  /** Volatility σ, e.g. 0.06. */
  volatility: number;
}

export interface Glicko2GameResult {
  /** The opponent's rating *before* this rating period. */
  opponent: Pick<Glicko2Rating, "rating" | "rd">;
  /** 1 = win, 0.5 = draw, 0 = loss. */
  score: number;
  /** Information weight in (0, 1]. Defaults to 1. */
  weight?: number;
}

const PI_SQUARED = Math.PI * Math.PI;
/** Safety valve for the volatility iteration (it converges in a handful of steps in practice). */
const MAX_ITERATIONS = 100;

function assertFiniteRating(r: Pick<Glicko2Rating, "rating" | "rd">, label: string): void {
  if (!Number.isFinite(r.rating) || !Number.isFinite(r.rd) || r.rd <= 0) {
    throw new RangeError(`glicko2: invalid ${label} rating ${JSON.stringify(r)}`);
  }
}

function assertGame(game: Glicko2GameResult): void {
  assertFiniteRating(game.opponent, "opponent");
  if (!(game.score >= 0 && game.score <= 1)) throw new RangeError(`glicko2: score must be in [0, 1], got ${game.score}`);
  const w = game.weight ?? 1;
  if (!(w > 0 && w <= 1)) throw new RangeError(`glicko2: weight must be in (0, 1], got ${w}`);
}

/** Step 2: Glicko → Glicko-2 scale. */
export function toGlicko2Scale(r: Pick<Glicko2Rating, "rating" | "rd">, defaultRating = 1500): { mu: number; phi: number } {
  return { mu: (r.rating - defaultRating) / GLICKO2_SCALE, phi: r.rd / GLICKO2_SCALE };
}

/** g(φ) — reduces the impact of a game according to the opponent's uncertainty. */
export function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / PI_SQUARED);
}

/** E(μ, μj, φj) — expected score against opponent j. */
export function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Expected score of `player` against `opponent` on the Glicko scale (0–1). Handy for UI ("you were
 * expected to win 64% of the time") and tests.
 */
export function winProbability(
  player: Pick<Glicko2Rating, "rating" | "rd">,
  opponent: Pick<Glicko2Rating, "rating" | "rd">,
  config: Glicko2Config = DEFAULT_GLICKO2_CONFIG,
): number {
  const p = toGlicko2Scale(player, config.defaultRating);
  const o = toGlicko2Scale(opponent, config.defaultRating);
  return expectedScore(p.mu, o.mu, o.phi);
}

/**
 * Step 5: new volatility σ' via the Illinois (regula falsi) algorithm, exactly as in the paper.
 * `delta` is Δ, `phi` is φ, `v` the estimated variance, `sigma` the current volatility.
 */
export function computeNewVolatility(delta: number, phi: number, v: number, sigma: number, config: Glicko2Config): number {
  const { tau, epsilon } = config;
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const delta2 = delta * delta;
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const denom = phi2 + v + ex;
    return (ex * (delta2 - phi2 - v - ex)) / (2 * denom * denom) - (x - a) / (tau * tau);
  };

  // Initial bracket.
  let A = a;
  let B: number;
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0 && k < MAX_ITERATIONS) k += 1;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  for (let i = 0; Math.abs(B - A) > epsilon && i < MAX_ITERATIONS; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/**
 * Rate one player over one rating period (Steps 2–8).
 *
 * - `games` are all games in the period, each against the opponent's *pre-period* rating.
 * - With no games, only RD grows (Step 6 shortcut) — rating and volatility are unchanged.
 * - The returned RD is clamped to [config.minRd, config.defaultRd].
 */
export function rate(
  player: Glicko2Rating,
  games: readonly Glicko2GameResult[],
  config: Glicko2Config = DEFAULT_GLICKO2_CONFIG,
): Glicko2Rating {
  assertFiniteRating(player, "player");
  if (!(player.volatility > 0) || !Number.isFinite(player.volatility)) {
    throw new RangeError(`glicko2: invalid volatility ${player.volatility}`);
  }
  games.forEach(assertGame);

  const { mu, phi } = toGlicko2Scale(player, config.defaultRating);
  const sigma = player.volatility;

  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: clampRd(phiStar * GLICKO2_SCALE, config), volatility: sigma };
  }

  // Steps 3 & 4: estimated variance v and improvement Δ (weighted).
  let invV = 0;
  let improvementSum = 0;
  for (const game of games) {
    const w = game.weight ?? 1;
    const opp = toGlicko2Scale(game.opponent, config.defaultRating);
    const gPhi = g(opp.phi);
    const e = expectedScore(mu, opp.mu, opp.phi);
    invV += w * gPhi * gPhi * e * (1 - e);
    improvementSum += w * gPhi * (game.score - e);
  }
  const v = 1 / invV;
  const delta = v * improvementSum;

  // Step 5: volatility.
  const sigmaPrime = computeNewVolatility(delta, phi, v, sigma, config);

  // Step 6: pre-rating-period value φ*.
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);

  // Step 7: new φ' and μ'.
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * improvementSum;

  // Step 8: back to the Glicko scale.
  return {
    rating: GLICKO2_SCALE * muPrime + config.defaultRating,
    rd: clampRd(GLICKO2_SCALE * phiPrime, config),
    volatility: sigmaPrime,
  };
}

function clampRd(rd: number, config: Glicko2Config): number {
  return Math.min(config.defaultRd, Math.max(config.minRd, rd));
}

/** The ratings of two players after a single game between them (one rating period, simultaneous update). */
export function rateHeadToHead(
  a: Glicko2Rating,
  b: Glicko2Rating,
  scoreA: number,
  weight = 1,
  config: Glicko2Config = DEFAULT_GLICKO2_CONFIG,
): { a: Glicko2Rating; b: Glicko2Rating } {
  return {
    a: rate(a, [{ opponent: b, score: scoreA, weight }], config),
    b: rate(b, [{ opponent: a, score: 1 - scoreA, weight }], config),
  };
}
