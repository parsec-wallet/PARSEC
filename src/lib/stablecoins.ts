// PARSEC Wallet — stablecoin reading for the landing's liquidity ship.
//
// A stablecoin has one job: hold its peg. Market cap says how much of it there
// is; the price says whether it is doing the job. The ship used to show only
// the first, so a coin trading at $0.97 looked exactly as healthy as one at
// $1.0000. This module reads both, as pure functions, so the thresholds are
// asserted in a test rather than eyeballed on the wall.
//
// Display only. Nothing here sits in a value path: a peg reading decides a
// colour, never an amount.

import type { CoinPrice } from './prices';

/** Coins pegged to one US dollar. */
export const USD_STABLES: ReadonlySet<string> = new Set([
  'USDT', 'USDC', 'USDS', 'USDE', 'DAI', 'USD1', 'FDUSD', 'PYUSD', 'RLUSD',
  'USDG', 'TUSD', 'BUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD',
]);

/** Coins backed by an ounce of gold. Their peg is the gold price, not a dollar. */
export const GOLD_STABLES: ReadonlySet<string> = new Set(['PAXG', 'XAUT']);

export type PegState = 'held' | 'drift' | 'depeg';

/** Within this many basis points of $1 the peg is held. */
export const PEG_HELD_BPS = 10;
/** Beyond this the coin has left its peg. Between the two it is drifting. */
export const PEG_DEPEG_BPS = 50;

export interface PegReading {
  /** Signed distance from $1 in basis points; +25 is $1.0025. */
  bps: number;
  state: PegState;
}

/** How far a dollar stablecoin sits from $1, or null when the price is unusable. */
export function pegReading(usd: number): PegReading | null {
  if (!Number.isFinite(usd) || usd <= 0) return null;
  const bps = (usd - 1) * 10_000;
  const abs = Math.abs(bps);
  const state: PegState = abs <= PEG_HELD_BPS ? 'held' : abs <= PEG_DEPEG_BPS ? 'drift' : 'depeg';
  return { bps, state };
}

export interface StableRow {
  coin: CoinPrice;
  /** Share of dollar-stablecoin liquidity, 0..1. Gold rows are measured against gold. */
  share: number;
  /** Null for gold, and for a dollar coin with no usable price. */
  peg: PegReading | null;
  /** 24h market-cap change in %, or null when the feed did not give one. */
  flowPct: number | null;
}

export type FlowState = 'inflow' | 'outflow' | 'flat';

/** Below this a day's move in stablecoin supply is noise, not a signal. */
export const FLOW_FLAT_PCT = 0.05;

export interface StableSummary {
  usd: StableRow[];
  gold: StableRow[];
  /** Total market cap of the dollar stablecoins. */
  usdLiquidity: number;
  goldLiquidity: number;
  /** Dollar stablecoins as a share of every coin in the feed, 0..1. Null without a feed. */
  shareOfMarket: number | null;
  /** Cap-weighted signed peg deviation across dollar coins, in bps. */
  weightedBps: number;
  /** The dollar coin furthest from its peg, if any has a reading. */
  largestDeviation: StableRow | null;
  held: number;
  drifting: number;
  depegged: number;
  /**
   * 24h change in total dollar-stablecoin market cap, in %. Stablecoins trade at
   * $1, so this is net minting less redemption: money arriving to be invested
   * when positive, money leaving the market when negative. Null when no coin
   * carried a figure.
   */
  flowPct: number | null;
  flow: FlowState;
}

/**
 * Aggregate 24h market-cap change across coins, in %.
 *
 * Each coin's cap a day ago is recovered from its change, so a large coin's
 * move counts for its size. Coins without a figure are left out of both sides
 * rather than treated as flat.
 */
export function aggregateFlow(rows: Array<{ cap: number; pct: number | null }>): number | null {
  let now = 0;
  let before = 0;
  for (const r of rows) {
    if (r.pct === null || !Number.isFinite(r.pct) || !(r.cap > 0) || r.pct <= -100) continue;
    now += r.cap;
    before += r.cap / (1 + r.pct / 100);
  }
  return before > 0 ? ((now - before) / before) * 100 : null;
}

export function flowState(pct: number | null): FlowState {
  if (pct === null || Math.abs(pct) < FLOW_FLAT_PCT) return 'flat';
  return pct > 0 ? 'inflow' : 'outflow';
}

/**
 * Read the stablecoins out of a price feed.
 *
 * `all` is the whole feed, used only for the market-share figure. Rows come
 * back largest first.
 */
export function summarizeStables(all: CoinPrice[]): StableSummary {
  const usdCoins = all.filter((c) => USD_STABLES.has(c.symbol)).sort((a, b) => b.marketCap - a.marketCap);
  const goldCoins = all.filter((c) => GOLD_STABLES.has(c.symbol)).sort((a, b) => b.marketCap - a.marketCap);

  const usdLiquidity = usdCoins.reduce((s, c) => s + (c.marketCap > 0 ? c.marketCap : 0), 0);
  const goldLiquidity = goldCoins.reduce((s, c) => s + (c.marketCap > 0 ? c.marketCap : 0), 0);
  const marketTotal = all.reduce((s, c) => s + (c.marketCap > 0 ? c.marketCap : 0), 0);

  const usd: StableRow[] = usdCoins.map((coin) => ({
    coin,
    share: usdLiquidity > 0 ? Math.max(0, coin.marketCap) / usdLiquidity : 0,
    peg: pegReading(coin.usd),
    flowPct: feedFlow(coin),
  }));
  const gold: StableRow[] = goldCoins.map((coin) => ({
    coin,
    share: goldLiquidity > 0 ? Math.max(0, coin.marketCap) / goldLiquidity : 0,
    peg: null,
    flowPct: feedFlow(coin),
  }));

  let weighted = 0;
  let weight = 0;
  let largestDeviation: StableRow | null = null;
  let held = 0;
  let drifting = 0;
  let depegged = 0;
  for (const row of usd) {
    if (!row.peg) continue;
    weighted += row.peg.bps * row.share;
    weight += row.share;
    if (row.peg.state === 'held') held++;
    else if (row.peg.state === 'drift') drifting++;
    else depegged++;
    if (!largestDeviation || Math.abs(row.peg.bps) > Math.abs(largestDeviation.peg!.bps)) largestDeviation = row;
  }

  const flowPct = aggregateFlow(usd.map((r) => ({ cap: r.coin.marketCap, pct: r.flowPct })));
  return {
    usd,
    gold,
    flowPct,
    flow: flowState(flowPct),
    usdLiquidity,
    goldLiquidity,
    shareOfMarket: marketTotal > 0 && usdLiquidity > 0 ? usdLiquidity / marketTotal : null,
    weightedBps: weight > 0 ? weighted / weight : 0,
    largestDeviation,
    held,
    drifting,
    depegged,
  };
}

/**
 * How far the ship lists, in degrees, from the cap-weighted peg deviation.
 *
 * Level while the pegs hold. A fleet trading under $1 lists to port (negative),
 * over $1 to starboard. Capped so a real depeg reads as alarming, not upside down.
 */
export function shipList(weightedBps: number): number {
  if (!Number.isFinite(weightedBps)) return 0;
  const past = Math.abs(weightedBps) - PEG_HELD_BPS / 2;
  if (past <= 0) return 0;
  return Math.sign(weightedBps) * Math.min(6, past * 0.12);
}

function feedFlow(coin: CoinPrice): number | null {
  const v = coin.mcapChange24h;
  return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
}

/** "+2.4 bp", "−38 bp": the deviation as a participant reads it. */
export function formatBps(bps: number): string {
  const abs = Math.abs(bps);
  const text = abs < 10 ? abs.toFixed(1) : Math.round(abs).toString();
  const sign = bps > 0.05 ? '+' : bps < -0.05 ? '−' : '';
  return `${sign}${text} bp`;
}
