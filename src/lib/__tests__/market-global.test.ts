import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setFetch,
  compactUsd,
  dominanceSplit,
  fearGreedLabel,
  fetchFearGreed,
  fetchGlobalMarket,
  fetchPerps,
  fundingAnnualPct,
  fundingBias,
  parseCoinDetail,
  parseDexVolume,
  parseFearGreed,
  parseGlobalMarket,
  parsePaprikaTicker,
  parsePerp,
  rangePosition,
  signedPct,
  turnoverPct,
} from '../market-global';

// Shapes copied from live responses on 2026-09-25, trimmed.
const GLOBAL = {
  data: {
    active_cryptocurrencies: 21562,
    markets: 1501,
    total_market_cap: { usd: 2_887_000_000_000, btc: 34_316_776 },
    total_volume: { usd: 107_200_000_000 },
    market_cap_percentage: { btc: 58.56, eth: 11.33, usdt: 6.36, usdc: 2.4, bnb: 3.56 },
    market_cap_change_percentage_24h_usd: -2.32,
    volume_change_percentage_24h_usd: -10.94,
    updated_at: 1790312758,
  },
};

const FNG = {
  data: Array.from({ length: 31 }, (_, i) => ({
    value: String(71 - i),
    value_classification: 'Greed',
    timestamp: String(1790294400 - i * 86400),
    ...(i === 0 ? { time_until_update: '67972' } : {}),
  })),
};

const BYBIT_ALGO = {
  retCode: 0,
  result: { list: [{
    symbol: 'ALGOUSDT', lastPrice: '0.11302', price24hPcnt: '0.062317',
    openInterestValue: '10935037.26', turnover24h: '7383349.1494',
    fundingRate: '0.00000352', nextFundingTime: '1790323200000',
  }] },
};

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

afterEach(() => __setFetch(null));

describe('parseGlobalMarket', () => {
  it('reads size, volume, change and dominance', () => {
    const g = parseGlobalMarket(GLOBAL)!;
    expect(g.totalMarketCapUsd).toBe(2_887_000_000_000);
    expect(g.totalVolumeUsd).toBe(107_200_000_000);
    expect(g.marketCapChange24hPct).toBeCloseTo(-2.32);
    expect(g.dominance.btc).toBeCloseTo(58.56);
    expect(g.updatedAt).toBe(1790312758_000);
  });

  it('refuses a body without a usable market cap', () => {
    expect(parseGlobalMarket(null)).toBeNull();
    expect(parseGlobalMarket({ data: { total_market_cap: {}, total_volume: { usd: 1 } } })).toBeNull();
  });

  it('keeps an unknown change as null, never zero', () => {
    const g = parseGlobalMarket({ data: { ...GLOBAL.data, market_cap_change_percentage_24h_usd: undefined } })!;
    expect(g.marketCapChange24hPct).toBeNull();
  });
});

describe('parseFearGreed', () => {
  it('picks now, yesterday, a week and a month back', () => {
    const f = parseFearGreed(FNG)!;
    expect(f.now.value).toBe(71);
    expect(f.yesterday!.value).toBe(70);
    expect(f.weekAgo!.value).toBe(64);
    expect(f.monthAgo!.value).toBe(41);
    expect(f.nextUpdateSec).toBe(67972);
  });

  it('degrades to null history when only one reading arrives', () => {
    const f = parseFearGreed({ data: [FNG.data[0]] })!;
    expect(f.now.value).toBe(71);
    expect(f.weekAgo).toBeNull();
  });

  it('is null, not "extreme fear", when there is nothing to read', () => {
    expect(parseFearGreed({ data: [] })).toBeNull();
    expect(parseFearGreed(null)).toBeNull();
  });
});

describe('parsePerp', () => {
  it('reads funding and open interest from Bybit strings', () => {
    const p = parsePerp(BYBIT_ALGO)!;
    expect(p.symbol).toBe('ALGOUSDT');
    expect(p.fundingRate).toBeCloseTo(0.00000352);
    expect(p.openInterestUsd).toBeCloseTo(10_935_037.26);
    expect(p.change24hPct).toBeCloseTo(6.2317);
  });

  it('rejects an error envelope', () => {
    expect(parsePerp({ retCode: 10001, result: { list: [] } })).toBeNull();
  });
});

describe('parseDexVolume and parseCoinDetail', () => {
  it('reads DEX volume', () => {
    const d = parseDexVolume({ total24h: 10_215_353_645, total7d: 75_880_586_034, change_1d: 1.34, change_7d: -0.4 })!;
    expect(d.total24hUsd).toBe(10_215_353_645);
    expect(d.change7dPct).toBeCloseTo(-0.4);
    expect(parseDexVolume({})).toBeNull();
  });

  it('reads a coin with multi-horizon change', () => {
    const c = parseCoinDetail([{
      id: 'algorand', symbol: 'algo', market_cap_rank: 60, current_price: 0.113,
      market_cap: 980_000_000, total_volume: 61_000_000, high_24h: 0.1152, low_24h: 0.1037,
      price_change_percentage_1h_in_currency: 0.5, price_change_percentage_24h_in_currency: 6.2,
      price_change_percentage_7d_in_currency: 9.1, price_change_percentage_30d_in_currency: -3,
      ath: 3.56, ath_change_percentage: -96.8, circulating_supply: 8.7e9, max_supply: 1e10,
    }])!;
    expect(c.symbol).toBe('ALGO');
    expect(c.rank).toBe(60);
    expect(c.change30dPct).toBe(-3);
    expect(parseCoinDetail([])).toBeNull();
  });
});

describe('derived readings', () => {
  it('splits dominance into BTC, ETH, stables and the rest', () => {
    const s = dominanceSplit(GLOBAL.data.market_cap_percentage);
    expect(s.btc).toBeCloseTo(58.56);
    expect(s.stables).toBeCloseTo(8.76);
    expect(s.alts).toBeCloseTo(100 - 58.56 - 11.33 - 8.76);
  });

  it('computes turnover and refuses a zero cap', () => {
    expect(turnoverPct(107.2, 2887)).toBeCloseTo(3.713, 2);
    expect(turnoverPct(1, 0)).toBeNull();
  });

  it('annualises and reads funding', () => {
    expect(fundingAnnualPct(0.0001)).toBeCloseTo(10.95);
    expect(fundingBias(0.0001)).toBe('longs pay');
    expect(fundingBias(-0.0002)).toBe('shorts pay');
    expect(fundingBias(0.00000352)).toBe('neutral');
  });

  it('places price in the daily range', () => {
    expect(rangePosition(0.11, 0.1, 0.12)).toBeCloseTo(50);
    expect(rangePosition(1, 1, 1)).toBeNull();
    expect(rangePosition(5, null, 6)).toBeNull();
  });

  it('labels Fear & Greed bands and formats figures', () => {
    expect(fearGreedLabel(10)).toBe('Extreme Fear');
    expect(fearGreedLabel(50)).toBe('Neutral');
    expect(fearGreedLabel(80)).toBe('Extreme Greed');
    expect(signedPct(1.234)).toBe('+1.23%');
    expect(signedPct(-4.5)).toBe('−4.50%');
    expect(signedPct(null)).toBe('—');
    expect(compactUsd(2_887_000_000_000)).toBe('$2.89T');
    expect(compactUsd(null)).toBe('—');
  });
});

describe('transport', () => {
  it('caches a reading so a 20 s refresh does not refetch', async () => {
    const f = vi.fn(async () => jsonResponse(GLOBAL));
    __setFetch(f as unknown as typeof fetch);
    await fetchGlobalMarket();
    await fetchGlobalMarket();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    const f = vi.fn(async () => jsonResponse(FNG));
    __setFetch(f as unknown as typeof fetch);
    const [a, b] = await Promise.all([fetchFearGreed(), fetchFearGreed()]);
    expect(a!.now.value).toBe(71);
    expect(b!.now.value).toBe(71);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns null on failure instead of throwing', async () => {
    __setFetch((async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(await fetchGlobalMarket()).toBeNull();
    __setFetch((async () => jsonResponse({}, false)) as unknown as typeof fetch);
    expect(await fetchFearGreed()).toBeNull();
  });

  it('drops a perp that could not be read and keeps the rest', async () => {
    __setFetch((async (url: string) =>
      jsonResponse(String(url).includes('ALGO') ? BYBIT_ALGO : { retCode: 10001 })) as unknown as typeof fetch);
    const perps = await fetchPerps(['BTC', 'ALGO']);
    expect(perps.map((p) => p.symbol)).toEqual(['ALGOUSDT']);
  });
});

describe('CoinPaprika fallback', () => {
  const PAPRIKA_GLOBAL = {
    market_cap_usd: 3_004_680_859_516, volume_24h_usd: 167_386_448_425,
    bitcoin_dominance_percentage: 56.27, cryptocurrencies_number: 12013,
    market_cap_change_24h: 0.13, volume_24h_change_24h: -10.29, last_updated: 1790313205,
  };

  it('stands in for CoinGecko when it refuses, carrying BTC dominance only', async () => {
    __setFetch((async (url: string) => String(url).includes('coingecko')
      ? jsonResponse({}, false)
      : jsonResponse(PAPRIKA_GLOBAL)) as unknown as typeof fetch);
    const g = (await fetchGlobalMarket())!;
    expect(g.source).toBe('coinpaprika');
    expect(g.totalMarketCapUsd).toBe(3_004_680_859_516);
    expect(g.dominance).toEqual({ btc: 56.27 });
  });

  it('reads a ticker and treats an uncomputed 30d change as unknown', () => {
    const c = parsePaprikaTicker({
      id: 'algo-algorand', symbol: 'ALGO', rank: 84, total_supply: 8_446_894_635, max_supply: 1e10,
      quotes: { USD: {
        price: 0.1131, volume_24h: 37_265_677, market_cap: 1_024_431_670,
        percent_change_1h: -0.16, percent_change_24h: 7.41, percent_change_7d: 19.47,
        percent_change_30d: 0, ath_price: 2.645, percent_from_price_ath: -95.72,
      } },
    })!;
    expect(c.source).toBe('coinpaprika');
    expect(c.change7dPct).toBeCloseTo(19.47);
    expect(c.change30dPct).toBeNull();
    expect(c.high24h).toBeNull();
    expect(parsePaprikaTicker({ quotes: {} })).toBeNull();
  });
});

describe('multi-asset readers', () => {
  it('returns coins in the order asked, dropping ones not returned', async () => {
    const { fetchCoinsDetail } = await import('../market-global');
    __setFetch((async () => jsonResponse([
      { id: 'bitcoin', symbol: 'btc', current_price: 84000 },
      { id: 'algorand', symbol: 'algo', current_price: 0.11 },
    ])) as unknown as typeof fetch);
    const got = await fetchCoinsDetail(['algorand', 'blast', 'bitcoin']);
    expect(got.map((c) => c.id)).toEqual(['algorand', 'bitcoin']);
  });

  it('reads TVL for several chains by name, case-insensitively', async () => {
    const { fetchChainTvls } = await import('../market-global');
    __setFetch((async () => jsonResponse([
      { name: 'Algorand', tvl: 34_599_636 }, { name: 'OP Mainnet', tvl: 400_000_000 }, { name: 'Tron', tvl: 5e9 },
    ])) as unknown as typeof fetch);
    const tvl = await fetchChainTvls(['algorand', 'OP Mainnet', 'Blast']);
    expect(tvl.get('algorand')).toBe(34_599_636);
    expect(tvl.get('OP Mainnet')).toBe(400_000_000);
    expect(tvl.has('Blast')).toBe(false);
  });
});
