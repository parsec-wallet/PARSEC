import { describe, it, expect, beforeEach } from 'vitest';
import { derivedChange, __resetHistory, parseFeed4h, changeFor, loadLastReading } from '../prices';

// History is populated by successful fetches. These pin the honest-null
// contract, which is the part that governs what the UI is allowed to claim.
beforeEach(() => __resetHistory());

describe('derived short-horizon changes', () => {
  it('is null with no history — for every period, and never zero', () => {
    // Zero would assert a flat market. "We have not been watching long enough"
    // is a different statement and must render differently.
    for (const p of ['5m', '15m', '4h'] as const) {
      expect(derivedChange('bitcoin', 100, p)).toBeNull();
    }
  });

  it('is null for an unknown coin', () => {
    expect(derivedChange('nonesuch', 42, '15m')).toBeNull();
  });

  it('is null when the current price is not usable', () => {
    expect(derivedChange('bitcoin', 0, '5m')).toBeNull();
    expect(derivedChange('bitcoin', -1, '5m')).toBeNull();
    expect(derivedChange('bitcoin', NaN, '5m')).toBeNull();
  });
});

describe('measured 4h change', () => {
  it('reads the rolling window when the exchange price matches the coin', () => {
    expect(parseFeed4h({ openPrice: '100', lastPrice: '102' }, 102.5)).toBeCloseTo(2);
  });

  it('refuses a ticker whose price says it is a different coin', () => {
    expect(parseFeed4h({ openPrice: '1', lastPrice: '1.1' }, 40)).toBeNull();
  });

  it('refuses an unreadable row rather than reporting zero', () => {
    expect(parseFeed4h({ openPrice: '0', lastPrice: '1' }, 1)).toBeNull();
    expect(parseFeed4h({}, 1)).toBeNull();
  });

  it('prefers the measured figure over the derived one for 4h', () => {
    const c = { id: 'm', symbol: 'M', usd: 1, marketCap: 1, change24h: 0, change1h: 0, change7d: null, change30d: null, change5m: null, change15m: null, change4h: null, image: '', feed4h: 3.5 };
    expect(changeFor(c, '4h').pct).toBe(3.5);
  });
});

describe('last good reading', () => {
  function withStorage(initial: Record<string, string>, fn: () => void) {
    const mem = new Map(Object.entries(initial));
    const prev = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    };
    try { fn(); } finally { (globalThis as { localStorage?: unknown }).localStorage = prev; }
  }
  const coin = { id: 'bitcoin', symbol: 'BTC', usd: 80000, marketCap: 1, change24h: 0, change1h: 0, change7d: null, change30d: null, change5m: null, change15m: null, change4h: null, image: '' };

  it('returns a recent reading', () => {
    withStorage({ 'parsec:price-last-reading': JSON.stringify({ at: 1000, coins: [coin] }) }, () => {
      expect(loadLastReading(2000)?.coins.map((c) => c.id)).toEqual(['bitcoin']);
    });
  });

  it('refuses one older than a day, or one that does not parse', () => {
    withStorage({ 'parsec:price-last-reading': JSON.stringify({ at: 0, coins: [coin] }) }, () => {
      expect(loadLastReading(25 * 60 * 60_000)).toBeNull();
    });
    withStorage({ 'parsec:price-last-reading': '{nope' }, () => {
      expect(loadLastReading(1)).toBeNull();
    });
  });

  it('drops entries without a usable price', () => {
    withStorage({ 'parsec:price-last-reading': JSON.stringify({ at: 1, coins: [{ ...coin, usd: 0 }] }) }, () => {
      expect(loadLastReading(2)).toBeNull();
    });
  });
});
