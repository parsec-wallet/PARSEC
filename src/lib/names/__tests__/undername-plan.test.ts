import { describe, expect, it } from 'vitest';
import { exactDecimal, maxAffordable, perSlot, phiFee, quoteSlots, SLIDER_MAX } from '../undername-plan';

const SLOT = 17_437_772n; // live ar.io quote, 2026-10-15: 17.437772 ARIO per undername slot (mARIO, 6 dp)

describe('the φ delivery fee', () => {
  it('is 0.01618033988749894848 of the cost, every digit kept', () => {
    // 1 ARIO = 1,000,000 mARIO → fee 0.01618033988749894848 ARIO exactly
    expect(phiFee(1_000_000n, 6).exact).toBe('0.01618033988749894848');
    expect(phiFee(100_000_000n, 6).exact).toBe('1.618033988749894848');
  });

  it('is exact on a real quote, and truncated only at the base unit', () => {
    const q = quoteSlots(4096, SLOT, 6);
    expect(exactDecimal(q.cost, 6)).toBe('71425.114112');                         // matches the live 4096 quote
    expect(q.fee.exact).toBe('1155.68262283555763746400894976');   // 71425.114112 × 0.01618033988749894848, checked with Python Decimal
    expect(q.fee.base).toBe(1_155_682_622n);   // mARIO, truncated: never rounded up
  });

  it('never rounds up', () => {
    for (const c of [1n, 7n, 61n, 999_999n, 123_456_789n]) {
      const f = phiFee(c, 6);
      expect(f.base * 10n ** 20n <= c * 1618033988749894848n).toBe(true);
      expect((f.base + 1n) * 10n ** 20n > c * 1618033988749894848n).toBe(true);
    }
  });
});

describe('slots', () => {
  it('derives the linear per-slot price from a quote', () => {
    expect(perSlot(871_888_600n, 50)).toBe(SLOT);
  });

  it('the most slots a balance covers, capped by the slider', () => {
    expect(maxAffordable(192_000_000_000n, SLOT)).toBe(11010);
    expect(maxAffordable(192_000_000_000n, SLOT, SLIDER_MAX)).toBe(4096);
    expect(maxAffordable(10_000_000n, SLOT)).toBe(0);
  });
});
