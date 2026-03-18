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

const COINS = 'bitcoin,ethereum,algorand,solana,ripple,cardano,polkadot,avalanche-2,dogecoin,tron';

let cache: CoinPrice[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds — casual realtime within free tier limits
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const SYMBOL_MAP: Record<string, string> = {
  bitcoin: 'BTC', ethereum: 'ETH', algorand: 'ALGO', solana: 'SOL',
  ripple: 'XRP', cardano: 'ADA', polkadot: 'DOT', 'avalanche-2': 'AVAX',
  dogecoin: 'DOGE', tron: 'TRX',
};

export async function fetchPrices(): Promise<CoinPrice[]> {
  if (cache && Date.now() - lastFetch < CACHE_TTL) return cache;

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${COINS}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) return cache || [];
    const data = await response.json();

    cache = Object.entries(data).map(([id, v]) => {
      const val = v as Record<string, number>;
      return {
        id,
        symbol: SYMBOL_MAP[id] || id.toUpperCase(),
        usd: val.usd || 0,
        marketCap: val.usd_market_cap || 0,
        change24h: val.usd_24h_change || 0,
      };
    }).sort((a, b) => b.marketCap - a.marketCap);

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

export function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return '$' + (cap / 1e12).toFixed(1) + 'T';
  if (cap >= 1e9) return '$' + (cap / 1e9).toFixed(1) + 'B';
  if (cap >= 1e6) return '$' + (cap / 1e6).toFixed(0) + 'M';
  return '$' + cap.toLocaleString();
}
