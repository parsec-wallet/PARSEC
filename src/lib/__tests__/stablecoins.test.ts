import { describe, it, expect } from 'vitest';
import { pegReading, summarizeStables, shipList, formatBps, aggregateFlow, flowState, PEG_HELD_BPS, PEG_DEPEG_BPS } from '../stablecoins';
import type { CoinPrice } from '../prices';

function coin(symbol: string, usd: number, marketCap: number): CoinPrice {
  return {
    id: symbol.toLowerCase(), symbol, usd, marketCap, change24h: 0, change1h: 0,
    change7d: null, change30d: null, change5m: null, change15m: null, change4h: null, image: '',
  };
}

describe('peg reading', () => {
  it('holds within the held band, drifts past it, depegs past the depeg band', () => {
    expect(pegReading(1.0005)!.state).toBe('held');
    expect(pegReading(1 - (PEG_HELD_BPS + 5) / 10_000)!.state).toBe('drift');
    expect(pegReading(1 - (PEG_DEPEG_BPS + 5) / 10_000)!.state).toBe('depeg');
    expect(pegReading(0.97)!.bps).toBeCloseTo(-300);
  });

  it('refuses an unusable price rather than calling it a depeg', () => {
    expect(pegReading(0)).toBeNull();
    expect(pegReading(Number.NaN)).toBeNull();
  });
});

describe('stablecoin summary', () => {
  const feed = [
    coin('BTC', 80_000, 1_600e9),
    coin('USDT', 1.0001, 150e9),
    coin('USDC', 0.9999, 70e9),
    coin('USDE', 0.99, 10e9),
    coin('PAXG', 3_800, 1e9),
  ];
  const s = summarizeStables(feed);

  it('keeps gold out of the dollar liquidity', () => {
    expect(s.usdLiquidity).toBe(230e9);
    expect(s.goldLiquidity).toBe(1e9);
    expect(s.gold.map((r) => r.coin.symbol)).toEqual(['PAXG']);
    expect(s.gold[0].peg).toBeNull();
  });

  it('orders by size and counts the roll call', () => {
    expect(s.usd.map((r) => r.coin.symbol)).toEqual(['USDT', 'USDC', 'USDE']);
    expect([s.held, s.drifting, s.depegged]).toEqual([2, 0, 1]);
    expect(s.largestDeviation?.coin.symbol).toBe('USDE');
  });

  it('measures dry powder against the whole feed', () => {
    expect(s.shareOfMarket).toBeCloseTo(230e9 / 1_831e9);
  });

  it('is empty, not broken, without stablecoins', () => {
    const e = summarizeStables([coin('BTC', 1, 1)]);
    expect(e.usd).toEqual([]);
    expect(e.shareOfMarket).toBeNull();
    expect(e.largestDeviation).toBeNull();
  });
});

describe('ship list', () => {
  it('sails level while the pegs hold', () => {
    expect(shipList(2)).toBe(0);
    expect(shipList(-4)).toBe(0);
  });
  it('lists to port under the peg, starboard over it, and never capsizes', () => {
    expect(shipList(-40)).toBeLessThan(0);
    expect(shipList(40)).toBeGreaterThan(0);
    expect(Math.abs(shipList(-5000))).toBeLessThanOrEqual(6);
  });
});

describe('formatBps', () => {
  it('signs and rounds the way it reads', () => {
    expect(formatBps(2.44)).toBe('+2.4 bp');
    expect(formatBps(-38.2)).toBe('−38 bp');
    expect(formatBps(0)).toBe('0.0 bp');
  });
});

describe('stablecoin flow', () => {
  it('weights each coin by its size', () => {
    // 100 grew 10% (from ~90.9), 10 shrank 50% (from 20): total 110.9 -> 110.
    const pct = aggregateFlow([{ cap: 100, pct: 10 }, { cap: 10, pct: -50 }])!;
    expect(pct).toBeCloseTo(((110 - (100 / 1.1 + 20)) / (100 / 1.1 + 20)) * 100);
  });

  it('leaves coins without a figure out rather than calling them flat', () => {
    expect(aggregateFlow([{ cap: 100, pct: 1 }, { cap: 1e12, pct: null }])).toBeCloseTo(1);
    expect(aggregateFlow([{ cap: 100, pct: null }])).toBeNull();
  });

  it('reads money arriving and money leaving', () => {
    expect(flowState(0.4)).toBe('inflow');
    expect(flowState(-0.4)).toBe('outflow');
    expect(flowState(0.01)).toBe('flat');
    expect(flowState(null)).toBe('flat');
  });

  it('summarizes the dollar coins only', () => {
    const usdt = { ...coin('USDT', 1, 100e9), mcapChange24h: 1 };
    const paxg = { ...coin('PAXG', 3800, 1e9), mcapChange24h: -30 };
    const s = summarizeStables([usdt, paxg]);
    expect(s.flowPct).toBeCloseTo(1);
    expect(s.flow).toBe('inflow');
    expect(s.gold[0].flowPct).toBe(-30);
  });
});
