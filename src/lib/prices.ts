// Parsec Wallet — Crypto Price Feed
// CoinGecko free tier. No API key. Casual pricing for display only.
// Cached. Fetched once per session. Not used for trading decisions.

export interface CoinPrice {
  id: string;
  symbol: string;
  usd: number;
  marketCap: number;
  change24h: number;
  image: string;
  /** 1 h change. From the feed; derived from observed history only if the feed omits it. */
  change1h: number;
  /** 7 d and 30 d change, from the feed. `null` when the feed did not supply one. */
  change7d: number | null;
  change30d: number | null;
  /** The feed's own 1 h figure, kept apart from the derived fallback. */
  feed1h?: number | null;
  /** Derived. `null` until this process has watched long enough to say. */
  change5m: DerivedChange | null;
  change15m: DerivedChange | null;
  change4h: DerivedChange | null;
}

/**
 * A change this process derived, and how long it actually watched to derive it.
 *
 * `pct` may be null while `observedMinutes` is not: that is the honest state of a feed
 * that is working but young, and it reads differently from a feed that is broken.
 */
export interface DerivedChange {
  pct: number | null;
  observedMinutes?: number;
}

// ── Derived short-horizon change ─────────────────────────────────────────────
//
// The feed gives one number: 24 hours. Everything shorter is derived here, from
// prices this process has actually watched.
//
// The contract that matters is the null. Zero asserts a flat market; null says *we
// have not been watching long enough to know*, and those must never render the same.
// A dashboard that shows 0.00% because it just started lies about the market with
// total confidence.

/**
 * Periods the participant can measure change over.
 *
 * 1h, 24h, 7d and 30d come straight from CoinGecko's free tier in the one markets
 * call the wallet already makes, so each has a figure the moment the wallet opens.
 * 4h has no free-tier figure. It is derived here from prices this process has
 * watched, and reads as a dash until about two hours have been observed.
 *
 * 5m and 15m are no longer offered. They are still derived for the price
 * cloud's surge detection.
 */
export const CHANGE_PERIODS = ['1h', '4h', '24h', '7d', '30d'] as const;
export type ChangePeriod = (typeof CHANGE_PERIODS)[number];
/** Windows this process can derive from its own observations. */
export type DerivedPeriod = '5m' | '15m' | '1h' | '4h' | '24h';

/** Window lengths in milliseconds. `5m` is accepted for callers that ask. */
const WINDOW_MS: Record<string, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

/** How far outside a window a sample may sit and still be used, as a fraction. */
const TOLERANCE = 0.5;

interface Sample { at: number; usd: number }

/** id → samples, oldest first. Memory only: a restart starts watching again. */
const history = new Map<string, Sample[]>();
const MAX_SAMPLES = 400;

/** Record a reading. Called on every successful fetch. */
export function recordPrices(prices: CoinPrice[], at = Date.now()): void {
  const horizon = at - WINDOW_MS['24h'] * 1.5;
  for (const coin of prices) {
    if (!Number.isFinite(coin.usd) || coin.usd <= 0) continue;
    const series = history.get(coin.id) ?? [];
    series.push({ at, usd: coin.usd });
    // Drop what no window can reach, then cap — a long-running session must not grow
    // without bound just because it stayed open.
    let trimmed = series.filter((s) => s.at >= horizon);
    if (trimmed.length > MAX_SAMPLES) trimmed = trimmed.slice(trimmed.length - MAX_SAMPLES);
    history.set(coin.id, trimmed);
  }
  // A coin that left the top 100 is no longer recorded, so its samples were
  // never trimmed and its key never removed. Drop any series gone stale.
  for (const [id, series] of history) {
    const last = series[series.length - 1];
    if (!last || last.at < horizon) history.delete(id);
  }
}

/**
 * Percentage change over `period`, or `null` when it cannot honestly be stated.
 *
 * Null when: the coin has never been seen, the current price is unusable, or no sample
 * sits far enough back to cover the window. The last is the common one on a fresh start
 * and is exactly what must not be reported as zero.
 */
export function derivedChange(id: string, currentUsd: number, period: DerivedPeriod, now = Date.now()): number | null {
  if (!Number.isFinite(currentUsd) || currentUsd <= 0) return null;
  const window = WINDOW_MS[period];
  if (!window) return null;

  const series = history.get(id);
  if (!series || series.length === 0) return null;

  const target = now - window;
  // The newest sample at or before the target — the closest honest comparison.
  let chosen: Sample | undefined;
  for (const s of series) {
    if (s.at <= target) chosen = s;
    else break;
  }
  // Nothing old enough. Accept a sample slightly inside the window rather than none,
  // but only slightly: comparing a 15-minute claim against 2 minutes of data is a
  // different number wearing the same label.
  if (!chosen) {
    const oldest = series[0];
    if (!oldest || now - oldest.at < window * (1 - TOLERANCE)) return null;
    chosen = oldest;
  }
  if (!Number.isFinite(chosen.usd) || chosen.usd <= 0) return null;
  return ((currentUsd - chosen.usd) / chosen.usd) * 100;
}

/** How long this process has been watching a coin, in minutes. */
export function observedMinutes(id: string, now = Date.now()): number | undefined {
  const series = history.get(id);
  if (!series || series.length === 0) return undefined;
  return Math.round((now - series[0].at) / 60_000);
}

/**
 * The change to show for a coin over a period.
 *
 * 24h comes from the feed, which has been watching far longer than this process.
 * Everything shorter is derived, and carries how long we watched — so a UI can say
 * "not yet" rather than showing a confident nothing.
 */
export function changeFor(coin: CoinPrice, period: ChangePeriod | DerivedPeriod, now = Date.now()): DerivedChange {
  const fin = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) ? v : null);
  if (period === '24h') return { pct: fin(coin.change24h) };
  if (period === '7d') return { pct: fin(coin.change7d) };
  if (period === '30d') return { pct: fin(coin.change30d) };
  if (period === '1h' && fin(coin.feed1h) !== null) return { pct: fin(coin.feed1h) };
  return {
    pct: derivedChange(coin.id, coin.usd, period, now),
    observedMinutes: observedMinutes(coin.id, now),
  };
}

export type FeedStatus = 'live' | 'stale' | 'down' | 'starting';

/** Whether the price feed is currently believable, and why. */
export function getFeedStatus(now = Date.now()): { status: FeedStatus; detail: string } {
  if (lastFetch === 0) return { status: 'starting', detail: 'no reading yet' };
  const age = now - lastFetch;
  if (lastFetchFailed && age > CACHE_TTL * 3) {
    return { status: 'down', detail: `no reading for ${Math.round(age / 60_000)}m` };
  }
  if (age > CACHE_TTL * 2) return { status: 'stale', detail: `${Math.round(age / 1000)}s old` };
  return { status: 'live', detail: `${Math.round(age / 1000)}s ago` };
}

/**
 * Forget every cached price and observation. Called on logout, so a new
 * session starts from a fresh reading rather than the last one's memory.
 */
export function clearPriceCaches(): void {
  cache = null;
  lastFetch = 0;
  lastFetchFailed = false;
  byIdCache.clear();
  history.clear();
}

/** Forget every observation. For tests, and for a session that changed feeds. */
export function __resetHistory(): void {
  history.clear();
}

/** A feed percentage, or null when absent or not a finite number. Never 0 for missing. */
function feedPct(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

let cache: CoinPrice[] | null = null;
let lastFetch = 0;
let lastFetchFailed = false;
const CACHE_TTL = 60 * 1000;

/** Fetch a specific set of coins by CoinGecko id. Used for the favourites
 *  strip — these may sit outside the top-100-by-mcap window returned by
 *  fetchPrices(). Cached 60s per sorted-id-list key. */
const byIdCache: Map<string, { at: number; data: CoinPrice[] }> = new Map();
export async function fetchPricesByIds(ids: string[]): Promise<CoinPrice[]> {
  if (ids.length === 0) return [];
  const key = [...ids].sort().join(',');
  const hit = byIdCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  try {
    const csv = encodeURIComponent(ids.join(','));
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${csv}&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d,30d`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) return hit?.data || [];
    const data = await response.json() as Record<string, unknown>[];

    const mapped = data.map(coin => ({
      id: String(coin.id || ''),
      symbol: String(coin.symbol || '').toUpperCase(),
      usd: Number(coin.current_price || 0),
      marketCap: Number(coin.market_cap || 0),
      change24h: Number(coin.price_change_percentage_24h || 0),
      image: String(coin.image || ''),
      change1h: feedPct(coin.price_change_percentage_1h_in_currency) ?? 0,
      feed1h: feedPct(coin.price_change_percentage_1h_in_currency),
      change7d: feedPct(coin.price_change_percentage_7d_in_currency),
      change30d: feedPct(coin.price_change_percentage_30d_in_currency),
      change5m: null,
      change15m: null,
      change4h: null,
    })).filter(c => c.id && c.usd > 0);

    byIdCache.delete(key);
    byIdCache.set(key, { at: Date.now(), data: mapped });
    // One entry per distinct id list — favourites, pinned extras, profiles.
    // Keep the most recent few; the oldest go first.
    for (const k of byIdCache.keys()) {
      if (byIdCache.size <= 32) break;
      byIdCache.delete(k);
    }
    return mapped;
  } catch {
    return hit?.data || [];
  }
}

/** Fetch top 100 coins by market cap from CoinGecko markets endpoint */
export async function fetchPrices(): Promise<CoinPrice[]> {
  if (cache && Date.now() - lastFetch < CACHE_TTL) return cache;

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=1h,24h,7d,30d',
      { signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) { lastFetchFailed = true; return cache || []; }
    const data = await response.json() as Record<string, unknown>[];

    cache = data.map(coin => ({
      id: String(coin.id || ''),
      symbol: String(coin.symbol || '').toUpperCase(),
      usd: Number(coin.current_price || 0),
      marketCap: Number(coin.market_cap || 0),
      change24h: Number(coin.price_change_percentage_24h || 0),
      image: String(coin.image || ''),
      change1h: feedPct(coin.price_change_percentage_1h_in_currency) ?? 0,
      feed1h: feedPct(coin.price_change_percentage_1h_in_currency),
      change7d: feedPct(coin.price_change_percentage_7d_in_currency),
      change30d: feedPct(coin.price_change_percentage_30d_in_currency),
      change5m: null,
      change15m: null,
      change4h: null,
    })).filter(c => c.id && c.usd > 0);

    lastFetch = Date.now();
    lastFetchFailed = false;
    // Every successful reading feeds the derived short-horizon changes. Without this
    // `derivedChange` is honest but permanently null.
    recordPrices(cache, lastFetch);
    // Attach what can be stated now; null where the window is not covered yet.
    for (const coin of cache) {
      if (coin.feed1h === null || coin.feed1h === undefined) {
        coin.change1h = derivedChange(coin.id, coin.usd, '1h', lastFetch) ?? 0;
      }
      coin.change5m = changeFor(coin, '5m', lastFetch);
      coin.change15m = changeFor(coin, '15m', lastFetch);
      coin.change4h = changeFor(coin, '4h', lastFetch);
    }
    return cache;
  } catch {
    lastFetchFailed = true;
    return cache || [];
  }
}

export function formatPrice(usd: number): string {
  if (usd >= 1000) return '$' + usd.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (usd >= 1) return '$' + usd.toFixed(2);
  if (usd >= 0.01) return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(6);
}

/** Start casual realtime price updates — call once, auto-refreshes */
export function startPriceUpdates(onUpdate: (prices: CoinPrice[]) => void): () => void {
  let stopped = false;
  // Initial fetch. A reading that lands after stop() is dropped, so a view
  // torn down mid-fetch is not called back (and not kept alive) by it.
  fetchPrices().then((p) => { if (!stopped) onUpdate(p); });

  // Refresh every 60s — within CoinGecko free tier (10-30 calls/min).
  // The timer is this caller's own: a shared module slot let a second caller
  // overwrite the first's id, leaving that interval impossible to clear.
  const timer = setInterval(() => {
    lastFetch = 0; // force refresh
    fetchPrices().then((p) => { if (!stopped) onUpdate(p); });
  }, CACHE_TTL);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Market activity index 0.0–1.0 from 24h price changes.
 * CoinGecko gives us 24h change. Real crypto day calibration:
 *
 *   24h change    what it feels like           matrix speed
 *   ─────────    ──────────────────           ────────────
 *   < 1%         dead sideways                0.08 — slow, mesmerizing
 *   1-2%         common, happens often        0.15 — gentle drift
 *   3-5%         a move, getting interesting   0.30 — moderate flow
 *   ~10%         normal day of getting it done 0.50 — working speed
 *   15-20%       strong move                  0.65 — brisk
 *   25%+         windy day (5%/hr territory)  0.80+ — fast, urgent
 *   40%+         storm                        0.90+ — frantic
 */
export function getMarketActivity(prices: CoinPrice[]): number {
  if (prices.length === 0) return 0.08;
  const avg = prices.reduce((sum, p) => sum + Math.abs(p.change24h), 0) / prices.length;
  // Piecewise linear — calibrated to real crypto daily swings
  if (avg <= 1) return 0.08 + avg * 0.07;          // 0-1% → 0.08-0.15
  if (avg <= 5) return 0.15 + (avg - 1) * 0.0375;  // 1-5% → 0.15-0.30
  if (avg <= 10) return 0.30 + (avg - 5) * 0.04;   // 5-10% → 0.30-0.50
  if (avg <= 25) return 0.50 + (avg - 10) * 0.02;  // 10-25% → 0.50-0.80
  return Math.min(0.95, 0.80 + (avg - 25) * 0.01); // 25%+ → 0.80-0.95
}

/**
 * Market sentiment -1.0 (deep bear/red) to +1.0 (strong bull/green).
 * Derived from weighted average 24h change (BTC/ETH weighted heavier).
 * Drives matrix rain color gradient: green = bull, red = bear.
 */
export function getMarketSentiment(prices: CoinPrice[]): number {
  if (prices.length === 0) return 0.0;
  // Weight by market cap — BTC and ETH dominate sentiment
  const totalCap = prices.reduce((s, p) => s + p.marketCap, 0);
  if (totalCap === 0) return 0.0;
  const weightedChange = prices.reduce((s, p) => s + p.change24h * (p.marketCap / totalCap), 0);
  // Clamp: ±5% weighted change maps to ±1.0
  return Math.max(-1.0, Math.min(1.0, weightedChange / 5.0));
}

/** Market breadth — what % of coins are green vs red */
export function getMarketBreadth(prices: CoinPrice[]): { greenPct: number; redPct: number; flatPct: number } {
  if (prices.length === 0) return { greenPct: 0, redPct: 0, flatPct: 100 };
  const green = prices.filter(p => p.change24h > 0.5).length;
  const red = prices.filter(p => p.change24h < -0.5).length;
  const flat = prices.length - green - red;
  return {
    greenPct: Math.round((green / prices.length) * 100),
    redPct: Math.round((red / prices.length) * 100),
    flatPct: Math.round((flat / prices.length) * 100),
  };
}

/** Total market cap from tracked coins */
export function getTotalMarketCap(prices: CoinPrice[]): number {
  return prices.reduce((s, p) => s + p.marketCap, 0);
}

/** BTC dominance % */
export function getBtcDominance(prices: CoinPrice[]): number {
  const total = getTotalMarketCap(prices);
  if (total === 0) return 0;
  const btc = prices.find(p => p.symbol === 'BTC');
  return btc ? (btc.marketCap / total) * 100 : 0;
}

/** Sector groupings for sorting */
export function categorize(coin: CoinPrice): string {
  const s = coin.symbol;
  if (['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD'].includes(s)) return 'stable';
  if (['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOT', 'MATIC', 'ALGO'].includes(s)) return 'major';
  if (['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF'].includes(s)) return 'meme';
  return 'alt';
}

export function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return '$' + (cap / 1e12).toFixed(2) + 'T';
  if (cap >= 1e9) return '$' + (cap / 1e9).toFixed(1) + 'B';
  if (cap >= 1e6) return '$' + (cap / 1e6).toFixed(0) + 'M';
  return '$' + cap.toLocaleString();
}
