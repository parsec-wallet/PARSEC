// Parsec Wallet — Crypto Price Feed
// CoinGecko free tier. No API key. Casual pricing for display only.
// Cached. Fetched once per session. Not used for trading decisions.

export interface CoinPrice {
  id: string;
  symbol: string;
  usd: number;
  marketCap: number;
  change24h: number;
}

let cache: CoinPrice[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 60 * 1000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Fetch top 100 coins by market cap from CoinGecko markets endpoint */
export async function fetchPrices(): Promise<CoinPrice[]> {
  if (cache && Date.now() - lastFetch < CACHE_TTL) return cache;

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h',
      { signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) return cache || [];
    const data = await response.json() as Record<string, unknown>[];

    cache = data.map(coin => ({
      id: String(coin.id || ''),
      symbol: String(coin.symbol || '').toUpperCase(),
      usd: Number(coin.current_price || 0),
      marketCap: Number(coin.market_cap || 0),
      change24h: Number(coin.price_change_percentage_24h || 0),
    })).filter(c => c.id && c.usd > 0);

    lastFetch = Date.now();
    return cache;
  } catch {
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
  // Initial fetch
  fetchPrices().then(onUpdate);

  // Refresh every 60s — within CoinGecko free tier (10-30 calls/min)
  refreshTimer = setInterval(() => {
    lastFetch = 0; // force refresh
    fetchPrices().then(onUpdate);
  }, CACHE_TTL);

  return () => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
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
  if (cap >= 1e12) return '$' + (cap / 1e12).toFixed(1) + 'T';
  if (cap >= 1e9) return '$' + (cap / 1e9).toFixed(1) + 'B';
  if (cap >= 1e6) return '$' + (cap / 1e6).toFixed(0) + 'M';
  return '$' + cap.toLocaleString();
}
