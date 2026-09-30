// Parsec Wallet — the market pyramid's hierarchy, as pure functions.
//
// One ranking decides both the pyramid and the cryptocloud, so they never tell
// different stories: a coin on the pyramid's gainer side floats in the cloud, a
// coin on the loser side sinks, and its rank sets how hard. The period is
// whatever the participant selected; this module only sees a percentage per coin.

export type Side = 'rise' | 'fall' | 'flat';

export interface CoinClass {
  side: Side;
  /** 0.25..1 — 1 for the largest gain or the largest loss, easing toward 0.25 as the move shrinks. */
  strength: number;
}

export interface PyramidRow<T> {
  /** Losers, in display order: largest loss outermost (leftmost). */
  left: T[];
  /** Gainers, in display order: largest gain innermost (next to the centre line). */
  right: T[];
}

export interface PyramidLayout<T> {
  apex: T | null;
  rows: PyramidRow<T>[];
  /** Everything that did not fit, highest change first, unknowns last. */
  base: T[];
  /** Gainers by largest gain first, losers by largest loss first; unknowns are in neither. */
  winners: T[];
  losers: T[];
}

/** Weakest lift a classified mover gets, so the last-ranked gainer still floats. */
const MIN_STRENGTH = 0.25;

function strengthAt(i: number, n: number): number {
  if (n <= 1) return 1;
  return 1 - (1 - MIN_STRENGTH) * (i / (n - 1));
}

/** Split into gainers (largest gain first), losers (largest loss first) and unknowns. */
function split<T>(items: T[], pctOf: (t: T) => number | null) {
  const known = items.filter((t) => pctOf(t) !== null);
  const unknown = items.filter((t) => pctOf(t) === null);
  const byPct = [...known].sort((a, b) => (pctOf(b) as number) - (pctOf(a) as number));
  const winners = byPct.filter((t) => (pctOf(t) as number) > 0);
  const losers = byPct.filter((t) => (pctOf(t) as number) <= 0).reverse();
  return { byPct, winners, losers, unknown };
}

/**
 * Class every coin as rising, falling or flat, with a strength from its rank.
 *
 * Gainers rank by largest gain, losers by largest loss: the largest gain and
 * the largest loss both get 1. A large loss is a large move -- it marks the
 * largest potential correction, not a lesser coin. A coin with no figure for the period, or exactly zero, is flat.
 */
export function classify<T>(items: T[], pctOf: (t: T) => number | null): Map<T, CoinClass> {
  const { winners, losers } = split(items, pctOf);
  const out = new Map<T, CoinClass>();
  for (const t of items) out.set(t, { side: 'flat', strength: 0 });
  const realLosers = losers.filter((t) => (pctOf(t) as number) < 0);
  winners.forEach((t, i) => out.set(t, { side: 'rise', strength: strengthAt(i, winners.length) }));
  realLosers.forEach((t, i) => out.set(t, { side: 'fall', strength: strengthAt(i, realLosers.length) }));
  return out;
}

/**
 * Lay the pyramid out.
 *
 * Shape: an apex, then rows of 2, 3, … bricks. Gainers only on the right,
 * losers only on the left — never crossing over. The shape stays whole when a
 * period is lopsided because the dividing line moves, not the sides: the right
 * side takes as many bricks as there are gainers to fill them (and the left the
 * rest), spread across the rows in proportion so every row keeps its count.
 */
export function layoutPyramid<T>(items: T[], pctOf: (t: T) => number | null, rowCount = 7): PyramidLayout<T> {
  const { byPct, winners, losers, unknown } = split(items, pctOf);
  const ranked = [...byPct, ...unknown];
  if (ranked.length === 0) return { apex: null, rows: [], base: [], winners, losers };

  // The apex is the largest gain; in a market with no gain, the smallest loss.
  const apex = winners[0] ?? ranked[0];
  const gainPool = winners.filter((t) => t !== apex);
  const losePool = losers.filter((t) => t !== apex);

  const bricks = Array.from({ length: rowCount }, (_, k) => k + 2);
  // The natural split is half and half (the odd brick to the gainers). A side
  // short of coins hands its spare bricks to the other, so the triangle stays
  // full whenever there are coins to fill it.
  const naturalG = bricks.reduce((n, b) => n + Math.ceil(b / 2), 0);
  const naturalL = bricks.reduce((n, b) => n + Math.floor(b / 2), 0);
  const g = Math.min(gainPool.length, naturalG + Math.max(0, naturalL - losePool.length));
  const l = Math.min(losePool.length, naturalL + Math.max(0, naturalG - gainPool.length));

  const rows: PyramidRow<T>[] = [];
  let usedG = 0;
  let usedL = 0;
  let cum = 0;
  for (const b of bricks) {
    cum += b;
    const filled = Math.min(cum, g + l);
    // Cumulative rounding keeps each row's split proportional and the totals exact.
    const wantG = g + l === 0 ? 0 : Math.round((filled * g) / (g + l));
    const rightN = Math.max(0, Math.min(wantG - usedG, g - usedG));
    const leftN = Math.max(0, Math.min(filled - wantG - usedL, l - usedL));
    rows.push({
      left: losePool.slice(usedL, usedL + leftN),
      right: gainPool.slice(usedG, usedG + rightN),
    });
    usedG += rightN;
    usedL += leftN;
  }

  const placed = new Set<T>([apex, ...gainPool.slice(0, usedG), ...losePool.slice(0, usedL)]);
  const base = ranked.filter((t) => !placed.has(t));
  return { apex, rows, base, winners, losers };
}
