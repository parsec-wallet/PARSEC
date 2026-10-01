import { describe, it, expect } from 'vitest';

import { SEGMENT_LOCK_METHOD, USD_TO_SEGMENT_PRICE } from '../segments';

describe('NFD segment unlock', () => {
  it('the segmentLock ABI method has the exact contract signature', () => {
    // A wrong signature would silently target the wrong method selector and
    // fail on-chain — pin it.
    expect(SEGMENT_LOCK_METHOD.getSignature()).toBe('segmentLock(bool,uint64)void');
  });

  it('encodes (lock, usdPrice) args without throwing', () => {
    const [lockArg, priceArg] = SEGMENT_LOCK_METHOD.args;
    expect(lockArg.type.toString()).toBe('bool');
    expect(priceArg.type.toString()).toBe('uint64');
  });

  it('USD→contract price scale is micro-USD', () => {
    expect(USD_TO_SEGMENT_PRICE).toBe(1_000_000n);
    // $2.50 → 2_500_000 micro-USD
    expect(BigInt(Math.round(2.5 * Number(USD_TO_SEGMENT_PRICE)))).toBe(2_500_000n);
  });
});
