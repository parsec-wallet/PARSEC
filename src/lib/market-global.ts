// Parsec Wallet — Whole-market readings for the Blue Pill
//
// The figures a trader reads before looking at any single coin: how big the
// market is, how much traded, who dominates, how frightened everyone is, where
// leverage sits, and — because Parsec is Algorand-first — the same questions
// asked of ALGO.
//
// Display only. Every value here is a third-party estimate rendered for a
// human; none of it is used to size, sign or validate a transaction, so plain
// `number` is correct here and `lib/money.ts` is not needed.
//
// Keyless sources, all of which allow a browser origin to read them:
//   api.coingecko.com   /global, /coins/markets   — size, volume, dominance, ALGO detail
//   api.alternative.me  /fng                      — Fear & Greed with history
//   api.llama.fi        /overview/dexs            — spot DEX volume, global and per chain
//   api.llama.fi        /v2/chains                — chain TVL
//   api.bybit.com       /v5/market/tickers        — perp funding rate and open interest
//   api.coinpaprika.com /v1/global, /v1/tickers   — fallback when CoinGecko rate-limits
//
// CoinGecko's free tier is shared with the price feed that drives the whole
// matrix screen and answers 429 readily. Its readings are cached for three
// minutes, and CoinPaprika stands in when it refuses. Every reading names the
// source that produced it, because the two differ at the margins.
//
// Each reader returns `null` rather than a zero when it could not read. A
// missing Fear & Greed is "unknown", not "extreme fear".

// ── Types ────────────────────────────────────────────────────────────────────

export interface GlobalMarket {
  totalMarketCapUsd: number;
  totalVolumeUsd: number;
  marketCapChange24hPct: number | null;
  volumeChange24hPct: number | null;
  /** Percent of total market cap, keyed by lower-case symbol (btc, eth, usdt…). */
  dominance: Record<string, number>;
  activeCryptocurrencies: number | null;
  markets: number | null;
  /** Unix ms of the source's own update. */
  updatedAt: number | null;
  source: 'coingecko' | 'coinpaprika';
}

export interface FearGreedPoint { value: number; label: string; at: number }

export interface FearGreed {
  now: FearGreedPoint;
  yesterday: FearGreedPoint | null;
  weekAgo: FearGreedPoint | null;
  monthAgo: FearGreedPoint | null;
  /** Seconds until alternative.me publishes the next reading. */
  nextUpdateSec: number | null;
}

export interface DexVolume {
  total24hUsd: number;
  total7dUsd: number | null;
  change1dPct: number | null;
  change7dPct: number | null;
}

export interface PerpReading {
  symbol: string;
  lastPrice: number;
  /** Per funding interval (8h on Bybit linear), as a fraction: 0.0001 = 0.01 %. */
  fundingRate: number;
  openInterestUsd: number;
  turnover24hUsd: number;
  change24hPct: number | null;
  nextFundingAt: number | null;
}

export interface CoinDetail {
  id: string;
  symbol: string;
  rank: number | null;
  priceUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  high24h: number | null;
  low24h: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  athUsd: number | null;
  athChangePct: number | null;
  circulatingSupply: number | null;
  maxSupply: number | null;
  source: 'coingecko' | 'coinpaprika';
}

// ── Transport ────────────────────────────────────────────────────────────────

type Fetch = typeof fetch;
let fetcher: Fetch = (...args) => fetch(...args);

/** Replace the transport. Tests only. */
export function __setFetch(f: Fetch | null): void {
  fetcher = f ?? ((...args) => fetch(...args));
  cache.clear();
}

const TTL_MS = 60_000;
/** CoinGecko shares its free budget with the price feed; ask it less often. */
const TTL_COINGECKO_MS = 180_000;
const ttlFor = (url: string) => (url.includes('api.coingecko.com') ? TTL_COINGECKO_MS : TTL_MS);
const cache = new Map<string, { at: number; value: unknown; pending?: Promise<unknown> }>();
/** Most URLs remembered. Per-coin and per-profile URLs vary; oldest go first. */
const MAX_URLS = 128;

function evictUrls(): void {
  for (const [k, v] of cache) {
    if (cache.size <= MAX_URLS) break;
    if (!v.pending) cache.delete(k);
  }
}

/**
 * Read a JSON document, cached for a minute and de-duplicated while in flight.
 *
 * The Global tab re-renders every 20 s and the pulse strip renders on every
 * entry; without this the free CoinGecko tier answers 429 within minutes. A
 * failed read falls back to the last good value when there is one.
 */
async function getJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  const hit = cache.get(url);
  const now = Date.now();
  if (hit && hit.value !== undefined && now - hit.at < ttlFor(url)) return hit.value as T;
  if (hit?.pending) return hit.pending as Promise<T | null>;

  const pending = (async () => {
    try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return (hit?.value as T | undefined) ?? null;
      const value = await res.json() as T;
      cache.delete(url);
      cache.set(url, { at: Date.now(), value });
      evictUrls();
      return value;
    } catch {
      return (hit?.value as T | undefined) ?? null;
    } finally {
      const cur = cache.get(url);
      if (cur?.pending) delete cur.pending;
    }
  })();
  cache.set(url, { at: hit?.at ?? 0, value: hit?.value, pending });
  return pending;
}

/** A finite number from an unknown JSON field, or null. Strings are accepted. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Readers ──────────────────────────────────────────────────────────────────

/** Total market cap, 24 h volume and dominance for the whole market. */
export async function fetchGlobalMarket(): Promise<GlobalMarket | null> {
  const body = await getJson<{ data?: Record<string, unknown> }>('https://api.coingecko.com/api/v3/global');
  return parseGlobalMarket(body)
    ?? parsePaprikaGlobal(await getJson<Record<string, unknown>>('https://api.coinpaprika.com/v1/global'));
}

/**
 * CoinPaprika's global reading. It carries BTC dominance only, so ETH and
 * stablecoin dominance are left absent — callers must show them as unknown.
 */
export function parsePaprikaGlobal(body: Record<string, unknown> | null): GlobalMarket | null {
  const cap = num(body?.market_cap_usd);
  const vol = num(body?.volume_24h_usd);
  if (cap === null || cap <= 0 || vol === null) return null;
  const btc = num(body?.bitcoin_dominance_percentage);
  const updated = num(body?.last_updated);
  return {
    totalMarketCapUsd: cap,
    totalVolumeUsd: vol,
    marketCapChange24hPct: num(body?.market_cap_change_24h),
    volumeChange24hPct: num(body?.volume_24h_change_24h),
    dominance: btc === null ? {} : { btc },
    activeCryptocurrencies: num(body?.cryptocurrencies_number),
    markets: null,
    updatedAt: updated === null ? null : updated * 1000,
    source: 'coinpaprika',
  };
}

export function parseGlobalMarket(body: { data?: Record<string, unknown> } | null): GlobalMarket | null {
  const d = body?.data;
  if (!d) return null;
  const cap = num((d.total_market_cap as Record<string, unknown> | undefined)?.usd);
  const vol = num((d.total_volume as Record<string, unknown> | undefined)?.usd);
  if (cap === null || cap <= 0 || vol === null) return null;

  const dominance: Record<string, number> = {};
  const pct = (d.market_cap_percentage ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(pct)) {
    const n = num(v);
    if (n !== null) dominance[k.toLowerCase()] = n;
  }
  const updated = num(d.updated_at);
  return {
    totalMarketCapUsd: cap,
    totalVolumeUsd: vol,
    marketCapChange24hPct: num(d.market_cap_change_percentage_24h_usd),
    volumeChange24hPct: num(d.volume_change_percentage_24h_usd),
    dominance,
    activeCryptocurrencies: num(d.active_cryptocurrencies),
    markets: num(d.markets),
    updatedAt: updated === null ? null : updated * 1000,
    source: 'coingecko',
  };
}

/** Fear & Greed now, and a day, a week and a month ago. */
export async function fetchFearGreed(): Promise<FearGreed | null> {
  const body = await getJson<{ data?: Array<Record<string, unknown>> }>('https://api.alternative.me/fng/?limit=31');
  return parseFearGreed(body);
}

export function parseFearGreed(body: { data?: Array<Record<string, unknown>> } | null): FearGreed | null {
  const rows = body?.data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const point = (r: Record<string, unknown> | undefined): FearGreedPoint | null => {
    if (!r) return null;
    const value = num(r.value);
    const at = num(r.timestamp);
    if (value === null || at === null) return null;
    return { value, label: String(r.value_classification ?? fearGreedLabel(value)), at: at * 1000 };
  };
  const now = point(rows[0]);
  if (!now) return null;
  return {
    now,
    yesterday: point(rows[1]),
    weekAgo: point(rows[7]),
    monthAgo: point(rows[30]),
    nextUpdateSec: num(rows[0].time_until_update),
  };
}

/** Spot DEX volume, whole market (`chain` omitted) or one chain ('algorand'). */
export async function fetchDexVolume(chain?: string): Promise<DexVolume | null> {
  const path = chain ? `/${encodeURIComponent(chain.toLowerCase())}` : '';
  const body = await getJson<Record<string, unknown>>(
    `https://api.llama.fi/overview/dexs${path}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume`,
    10_000,
  );
  return parseDexVolume(body);
}

export function parseDexVolume(body: Record<string, unknown> | null): DexVolume | null {
  const total = num(body?.total24h);
  if (total === null) return null;
  return {
    total24hUsd: total,
    total7dUsd: num(body?.total7d),
    change1dPct: num(body?.change_1d),
    change7dPct: num(body?.change_7d),
  };
}

/** TVL of one chain by its DeFiLlama name ('Algorand'). */
export async function fetchChainTvl(name: string): Promise<number | null> {
  const body = await getJson<Array<{ name?: string; tvl?: unknown }>>('https://api.llama.fi/v2/chains', 10_000);
  if (!Array.isArray(body)) return null;
  const row = body.find((c) => c.name?.toLowerCase() === name.toLowerCase());
  return row ? num(row.tvl) : null;
}

/** Perpetual funding and open interest for USDT-margined linear contracts. */
export async function fetchPerps(bases: readonly string[]): Promise<PerpReading[]> {
  const out = await Promise.all(bases.map(async (base) => {
    const symbol = `${base.toUpperCase()}USDT`;
    const body = await getJson<{ retCode?: number; result?: { list?: Array<Record<string, unknown>> } }>(
      `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`,
    );
    return parsePerp(body);
  }));
  return out.filter((p): p is PerpReading => p !== null);
}

export function parsePerp(body: { retCode?: number; result?: { list?: Array<Record<string, unknown>> } } | null): PerpReading | null {
  if (!body || body.retCode !== 0) return null;
  const t = body.result?.list?.[0];
  if (!t) return null;
  const last = num(t.lastPrice);
  const funding = num(t.fundingRate);
  const oi = num(t.openInterestValue);
  if (last === null || funding === null || oi === null) return null;
  const pcnt = num(t.price24hPcnt);
  return {
    symbol: String(t.symbol ?? ''),
    lastPrice: last,
    fundingRate: funding,
    openInterestUsd: oi,
    turnover24hUsd: num(t.turnover24h) ?? 0,
    change24hPct: pcnt === null ? null : pcnt * 100,
    nextFundingAt: num(t.nextFundingTime),
  };
}

/** One coin in depth — rank, range, multi-horizon change, ATH, supply. */
/**
 * Several coins in depth in one request, in the order asked for.
 *
 * One call rather than one per coin: a profile emphasises a dozen assets and
 * the free tier would refuse a dozen calls. Coins CoinGecko did not return are
 * simply absent — the caller shows them as unknown.
 */
export async function fetchCoinsDetail(ids: readonly string[]): Promise<CoinDetail[]> {
  if (ids.length === 0) return [];
  const csv = [...ids].sort().map(encodeURIComponent).join(',');
  const body = await getJson<Array<Record<string, unknown>>>(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${csv}&price_change_percentage=1h,24h,7d,30d`,
    10_000,
  );
  const byId = new Map<string, CoinDetail>();
  for (const row of Array.isArray(body) ? body : []) {
    const c = parseCoinDetail([row]);
    if (c) byId.set(c.id, c);
  }
  return ids.map((id) => byId.get(id)).filter((c): c is CoinDetail => c !== undefined);
}

/** TVL for several DeFiLlama chains from one read of the chain list. */
export async function fetchChainTvls(names: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const body = await getJson<Array<{ name?: string; tvl?: unknown }>>('https://api.llama.fi/v2/chains', 10_000);
  if (!Array.isArray(body)) return out;
  const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
  for (const row of body) {
    const key = row.name?.toLowerCase();
    const tvl = num(row.tvl);
    if (key && tvl !== null && wanted.has(key)) out.set(wanted.get(key)!, tvl);
  }
  return out;
}

/** Forget every cached reading. Called on logout, so nothing carries over. */
export function clearMarketCache(): void {
  cache.clear();
}

/** CoinGecko id → CoinPaprika id, for the coins this panel asks about. */
const PAPRIKA_IDS: Record<string, string> = { algorand: 'algo-algorand', bitcoin: 'btc-bitcoin' };

export async function fetchCoinDetail(id: string): Promise<CoinDetail | null> {
  const body = await getJson<Array<Record<string, unknown>>>(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(id)}&price_change_percentage=1h,24h,7d,30d`,
    10_000,
  );
  const cg = parseCoinDetail(body);
  if (cg) return cg;
  const pid = PAPRIKA_IDS[id];
  if (!pid) return null;
  return parsePaprikaTicker(await getJson<Record<string, unknown>>(`https://api.coinpaprika.com/v1/tickers/${pid}`));
}

/**
 * CoinPaprika's ticker. It has no 24 h high/low, and reports a 30 d change of
 * exactly 0 when it has not computed one, so 0 there is read as unknown.
 */
export function parsePaprikaTicker(body: Record<string, unknown> | null): CoinDetail | null {
  const q = (body?.quotes as Record<string, Record<string, unknown>> | undefined)?.USD;
  const price = num(q?.price);
  if (!body || !q || price === null || price <= 0) return null;
  const nonZero = (v: unknown) => { const n = num(v); return n === 0 ? null : n; };
  const ath = num(q.ath_price);
  return {
    id: String(body.id ?? ''),
    symbol: String(body.symbol ?? '').toUpperCase(),
    rank: num(body.rank),
    priceUsd: price,
    marketCapUsd: num(q.market_cap) ?? 0,
    volume24hUsd: num(q.volume_24h) ?? 0,
    high24h: null,
    low24h: null,
    change1hPct: num(q.percent_change_1h),
    change24hPct: num(q.percent_change_24h),
    change7dPct: num(q.percent_change_7d),
    change30dPct: nonZero(q.percent_change_30d),
    athUsd: ath,
    athChangePct: num(q.percent_from_price_ath),
    circulatingSupply: num(body.circulating_supply) ?? num(body.total_supply),
    maxSupply: num(body.max_supply),
    source: 'coinpaprika',
  };
}

export function parseCoinDetail(body: Array<Record<string, unknown>> | null): CoinDetail | null {
  const c = Array.isArray(body) ? body[0] : undefined;
  if (!c) return null;
  const price = num(c.current_price);
  if (price === null || price <= 0) return null;
  return {
    id: String(c.id ?? ''),
    symbol: String(c.symbol ?? '').toUpperCase(),
    rank: num(c.market_cap_rank),
    priceUsd: price,
    marketCapUsd: num(c.market_cap) ?? 0,
    volume24hUsd: num(c.total_volume) ?? 0,
    high24h: num(c.high_24h),
    low24h: num(c.low_24h),
    change1hPct: num(c.price_change_percentage_1h_in_currency),
    change24hPct: num(c.price_change_percentage_24h_in_currency) ?? num(c.price_change_percentage_24h),
    change7dPct: num(c.price_change_percentage_7d_in_currency),
    change30dPct: num(c.price_change_percentage_30d_in_currency),
    athUsd: num(c.ath),
    athChangePct: num(c.ath_change_percentage),
    circulatingSupply: num(c.circulating_supply),
    maxSupply: num(c.max_supply),
    source: 'coingecko',
  };
}

// ── Derived readings ─────────────────────────────────────────────────────────

/** The stablecoins CoinGecko reports in its dominance table. */
const STABLE_KEYS = new Set(['usdt', 'usdc', 'dai', 'usde', 'fdusd', 'busd', 'tusd', 'pyusd', 'usds', 'usd1']);

/** Dominance split into BTC, ETH, stablecoins, and everything else. */
export function dominanceSplit(dom: Record<string, number>): { btc: number; eth: number; stables: number; alts: number } {
  const btc = dom.btc ?? 0;
  const eth = dom.eth ?? 0;
  let stables = 0;
  for (const [k, v] of Object.entries(dom)) if (STABLE_KEYS.has(k)) stables += v;
  const alts = Math.max(0, 100 - btc - eth - stables);
  return { btc, eth, stables, alts };
}

/**
 * 24 h volume as a percentage of market cap — turnover.
 *
 * High turnover means conviction behind a move; a price change on thin
 * turnover is easier to reverse. Null when the cap is not usable.
 */
export function turnoverPct(volumeUsd: number, marketCapUsd: number): number | null {
  if (!Number.isFinite(volumeUsd) || !Number.isFinite(marketCapUsd) || marketCapUsd <= 0) return null;
  return (volumeUsd / marketCapUsd) * 100;
}

/** alternative.me's own bands, for when a reading arrives without a label. */
export function fearGreedLabel(value: number): string {
  if (value < 25) return 'Extreme Fear';
  if (value < 47) return 'Fear';
  if (value <= 54) return 'Neutral';
  if (value <= 75) return 'Greed';
  return 'Extreme Greed';
}

/**
 * A per-interval funding rate as an annual percentage.
 *
 * Bybit linear perps fund every 8 h, three times a day. Positive means longs
 * pay shorts: the crowd is leaning long.
 */
export function fundingAnnualPct(ratePerInterval: number, intervalsPerDay = 3): number {
  return ratePerInterval * intervalsPerDay * 365 * 100;
}

/** Plain-language reading of a funding rate. */
export function fundingBias(ratePerInterval: number): 'longs pay' | 'shorts pay' | 'neutral' {
  // ±0.005 % per 8 h is inside the noise around Bybit's 0.01 % baseline.
  if (ratePerInterval > 0.00005) return 'longs pay';
  if (ratePerInterval < -0.00005) return 'shorts pay';
  return 'neutral';
}

/** Where `price` sits in the 24 h range, 0 (at the low) to 100 (at the high). */
export function rangePosition(price: number, low: number | null, high: number | null): number | null {
  if (low === null || high === null || !Number.isFinite(price) || high <= low) return null;
  return Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
}

/** Signed percentage for display: "+1.23%", "−4.50%", or "—" when unknown. */
export function signedPct(pct: number | null | undefined, digits = 2): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  const s = Math.abs(pct).toFixed(digits);
  return `${pct >= 0 ? '+' : '−'}${s}%`;
}

/** Compact USD: $3.21T, $98.4B, $512M, $12.3K. */
export function compactUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
