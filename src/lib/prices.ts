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

export function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return '$' + (cap / 1e12).toFixed(1) + 'T';
  if (cap >= 1e9) return '$' + (cap / 1e9).toFixed(1) + 'B';
  if (cap >= 1e6) return '$' + (cap / 1e6).toFixed(0) + 'M';
  return '$' + cap.toLocaleString();
}
