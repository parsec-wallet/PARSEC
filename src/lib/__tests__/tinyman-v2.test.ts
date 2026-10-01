import { describe, it, expect } from 'vitest';
import { tinymanPoolAddress, fixedInputOut } from '../dex/tinyman-onchain';

describe('Tinyman v2 pools', () => {
  it('derives the mainnet ALGO/USDC pool, in either asset order', () => {
    // Verified on chain 2026-10-01: local state asset_1_id 31566704, asset_2_id 0.
    const pool = '2PIFZW53RHCSFSYMCFUBW4XOCXOMB7XOYQSQ6KGT3KVGJTL4HM6COZRNMM';
    expect(tinymanPoolAddress(1002541853, 0, 31566704)).toBe(pool);
    expect(tinymanPoolAddress(1002541853, 31566704, 0)).toBe(pool);
  });

  it('computes a fixed-input swap exactly', () => {
    // 10 ALGO into a pool of 6,943,545.847179 ALGO / 890,343.556992 USDC at 36 bps.
    const out = fixedInputOut(10_000_000n, 6_943_545_847_179n, 890_343_556_992n, 36n);
    expect(out).toBe(1_277_642n);
    expect(fixedInputOut(0n, 1n, 1n, 30n)).toBe(0n);
    expect(fixedInputOut(10n, 0n, 1n, 30n)).toBe(0n);
  });
});
