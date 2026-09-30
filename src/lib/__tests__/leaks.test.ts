import { describe, expect, it, vi } from 'vitest';
import { queryCache, clearQueryCache } from '../algorand/query-cache';
import { recordPrices, derivedChange, clearPriceCaches, startPriceUpdates, type CoinPrice } from '../prices';

const coin = (id: string, usd = 1): CoinPrice => ({
  id, symbol: id.toUpperCase(), usd, marketCap: 1, change24h: 0, change1h: 0,
  change7d: null, change30d: null, image: '', change5m: null, change15m: null, change4h: null,
});

describe('bounded caches', () => {
  it('the Algorand query cache holds at most 500 entries, oldest evicted', async () => {
    clearQueryCache();
    for (let i = 0; i < 520; i++) await queryCache(`k${i}`, 60_000, async () => i);
    let refetched = false;
    await queryCache('k0', 60_000, async () => { refetched = true; return 0; });
    expect(refetched).toBe(true);
    let cached = true;
    await queryCache('k519', 60_000, async () => { cached = false; return 0; });
    expect(cached).toBe(true);
    clearQueryCache();
  });

  it('price history forgets a coin that stopped being reported', () => {
    clearPriceCaches();
    const t0 = 1_000_000_000_000;
    recordPrices([coin('gone', 1), coin('stays', 1)], t0);
    // Two days later only one coin is still in the feed.
    recordPrices([coin('stays', 2)], t0 + 48 * 3_600_000);
    expect(derivedChange('gone', 1, '1h', t0 + 48 * 3_600_000)).toBeNull();
    clearPriceCaches();
  });
});

describe('price updates stop cleanly', () => {
  it('drops a reading that lands after stop, and clears its own timer', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response);
    vi.stubGlobal('fetch', fetchSpy);
    const seen: number[] = [];
    const stopA = startPriceUpdates(() => seen.push(1));
    const stopB = startPriceUpdates(() => seen.push(2));
    stopA();
    stopB();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(seen).toEqual([]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
