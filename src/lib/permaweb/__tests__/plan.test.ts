import { describe, it, expect } from 'vitest';
import { planBridge, DEFAULT_TEST_TRANCHE_RAW } from '../bridge/plan';

const M = 1_000_000n;
describe('bridge plan', () => {
  it('splits a large migration into a test tranche + remainder', () => {
    const p = planBridge({ balanceRaw: 100_152n * M, amountRaw: 100_152n * M, minAmountRaw: M, bridgeClosing: true });
    expect(p.errors).toEqual([]);
    expect(p.tranches).toEqual([DEFAULT_TEST_TRANCHE_RAW, 100_052n * M]);
    expect(p.warnings[0]).toMatch(/closing/);
  });
  it('sends a single tranche when the amount is small', () => {
    expect(planBridge({ balanceRaw: 50n * M, amountRaw: 50n * M, minAmountRaw: M }).tranches).toEqual([50n * M]);
    expect(planBridge({ balanceRaw: 500n * M, amountRaw: 500n * M, minAmountRaw: M, testTrancheRaw: 0n }).tranches).toEqual([500n * M]);
  });
  it('flags below-minimum, over-balance and zero amounts', () => {
    expect(planBridge({ balanceRaw: 10n * M, amountRaw: 0n, minAmountRaw: M }).errors).toContain('Amount must be positive');
    expect(planBridge({ balanceRaw: 10n * M, amountRaw: 11n * M, minAmountRaw: M }).errors.join()).toMatch(/exceeds/);
    expect(planBridge({ balanceRaw: 10n * M, amountRaw: 500_000n, minAmountRaw: M }).errors.join()).toMatch(/minimum/);
  });
});
