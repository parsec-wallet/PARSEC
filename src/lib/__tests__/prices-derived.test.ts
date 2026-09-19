import { describe, it, expect, beforeEach } from 'vitest';
import { derivedChange, __resetHistory } from '../prices';

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
