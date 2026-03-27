import { describe, it, expect, beforeEach } from 'vitest';
import { addSwapRecord, getSwapHistory, clearSwapHistory, formatSwapDate } from '../history';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

function makeRecord(overrides: Partial<Omit<Parameters<typeof addSwapRecord>[0], never>> = {}) {
  return {
    inputAssetId: 0,
    inputSymbol: 'ALGO',
    inputAmount: 1000000,
    outputAssetId: 31566704,
    outputSymbol: 'USDC',
    outputAmount: 250000,
    txId: 'TXID123',
    dex: 'tinyman',
    isMultiHop: false,
    hops: 1,
    network: 'mainnet',
    ...overrides,
  };
}

describe('Swap History', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('getSwapHistory returns empty array when no history', () => {
    expect(getSwapHistory()).toEqual([]);
  });

  it('addSwapRecord adds a record with auto-generated id and timestamp', () => {
    addSwapRecord(makeRecord());
    const history = getSwapHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toMatch(/^swap_/);
    expect(history[0].timestamp).toBeGreaterThan(0);
    expect(history[0].inputSymbol).toBe('ALGO');
    expect(history[0].outputSymbol).toBe('USDC');
  });

  it('records are in reverse chronological order (newest first)', () => {
    addSwapRecord(makeRecord({ txId: 'TX1' }));
    // Small delay to ensure different timestamps
    addSwapRecord(makeRecord({ txId: 'TX2' }));
    addSwapRecord(makeRecord({ txId: 'TX3' }));

    const history = getSwapHistory();
    expect(history).toHaveLength(3);
    // newest first — TX3 was added last, so it should be first
    expect(history[0].txId).toBe('TX3');
    expect(history[1].txId).toBe('TX2');
    expect(history[2].txId).toBe('TX1');
  });

  it('max 100 records — adding 101st trims oldest', () => {
    for (let i = 0; i < 101; i++) {
      addSwapRecord(makeRecord({ txId: `TX${i}` }));
    }
    const history = getSwapHistory();
    expect(history).toHaveLength(100);
    // The oldest (TX0) should have been trimmed
    expect(history[99].txId).toBe('TX1');
    // The newest (TX100) should be first
    expect(history[0].txId).toBe('TX100');
  });

  it('clearSwapHistory removes all records', () => {
    addSwapRecord(makeRecord());
    addSwapRecord(makeRecord());
    expect(getSwapHistory()).toHaveLength(2);

    clearSwapHistory();
    expect(getSwapHistory()).toEqual([]);
  });

  it('formatSwapDate formats correctly (M/D/YYYY HH:MM)', () => {
    // 2026-03-15 14:05:00 UTC
    const ts = new Date(2026, 2, 15, 14, 5, 0).getTime();
    const formatted = formatSwapDate(ts);
    // Month is 1-indexed, so March = 3
    expect(formatted).toBe('3/15/2026 14:05');
  });

  it('formatSwapDate pads hours and minutes with leading zeros', () => {
    const ts = new Date(2026, 0, 5, 8, 3, 0).getTime();
    const formatted = formatSwapDate(ts);
    expect(formatted).toBe('1/5/2026 08:03');
  });
});
