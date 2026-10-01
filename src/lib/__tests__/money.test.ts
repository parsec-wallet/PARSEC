import { describe, it, expect } from 'vitest';
import {
  ALGO_DECIMALS,
  USD_DECIMALS,
  applyPercentOff,
  formatDecimal,
  mulDiv,
  parseDecimal,
  rescale,
  usdToAssetUnits,
} from '../money';

describe('parseDecimal', () => {
  it('parses exactly, without a float in the path', () => {
    expect(parseDecimal('1.50', 6)).toBe(1_500_000n);
    expect(parseDecimal('0.000001', 6)).toBe(1n);
    expect(parseDecimal('1234', 6)).toBe(1_234_000_000n);
  });

  it('is exact where a float is not', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754; here it is exact.
    expect(parseDecimal('0.1', 6) + parseDecimal('0.2', 6)).toBe(parseDecimal('0.3', 6));
  });

  it('handles a sign', () => {
    expect(parseDecimal('-2.5', 6)).toBe(-2_500_000n);
    expect(parseDecimal('+2.5', 6)).toBe(2_500_000n);
  });

  it('refuses to silently drop precision', () => {
    // Truncating someone's money is the failure this module exists to prevent.
    expect(() => parseDecimal('0.0000001', 6)).toThrow(RangeError);
  });

  it('rejects junk rather than yielding NaN', () => {
    // parseFloat('abc') gives NaN and poisons everything downstream.
    for (const bad of ['', 'abc', '1.2.3', '1e6', '$1.00', ' ']) {
      expect(() => parseDecimal(bad, 6), bad).toThrow();
    }
  });
});

describe('formatDecimal', () => {
  it('round-trips', () => {
    expect(formatDecimal(parseDecimal('1.5', 6), 6)).toBe('1.5');
    expect(formatDecimal(1_234_567n, 6)).toBe('1.234567');
  });

  it('renders whole values without a point', () => {
    expect(formatDecimal(2_000_000n, 6)).toBe('2');
  });

  it('truncates only for display, on request', () => {
    expect(formatDecimal(1_234_567n, 6, { maxFractionDigits: 2 })).toBe('1.23');
  });

  it('keeps the sign and pads small fractions', () => {
    expect(formatDecimal(-1n, 6)).toBe('-0.000001');
  });
});

describe('mulDiv', () => {
  it('keeps intermediates exact at full width', () => {
    // a*b would lose precision as a double long before this.
    const big = 10n ** 30n;
    expect(mulDiv(big, big, big)).toBe(big);
  });

  it('honours the rounding mode', () => {
    expect(mulDiv(10n, 1n, 3n, 'floor')).toBe(3n);
    expect(mulDiv(10n, 1n, 3n, 'ceil')).toBe(4n);
    expect(mulDiv(5n, 1n, 2n, 'half-up')).toBe(3n);
    expect(mulDiv(4n, 1n, 3n, 'half-up')).toBe(1n);
  });

  it('rounds away from zero consistently for negatives', () => {
    expect(mulDiv(-10n, 1n, 3n, 'ceil')).toBe(-4n);
  });

  it('refuses division by zero', () => {
    expect(() => mulDiv(1n, 1n, 0n)).toThrow(RangeError);
  });
});

describe('rescale', () => {
  it('widens exactly and narrows with explicit rounding', () => {
    expect(rescale(1_500_000n, 6, 8)).toBe(150_000_000n);
    expect(rescale(1_234_567n, 6, 2, 'floor')).toBe(123n);
    expect(rescale(1_234_567n, 6, 2, 'ceil')).toBe(124n);
  });

  it('is a no-op at the same scale', () => {
    expect(rescale(42n, 6, 6)).toBe(42n);
  });
});

describe('applyPercentOff', () => {
  it('applies the BANKON holder discount exactly', () => {
    // 50% off $1.00 — the real case from DEFAULT_DISCOUNT_PCT.
    expect(applyPercentOff(parseDecimal('1.00', 6), 50)).toBe(parseDecimal('0.50', 6));
  });

  it('never rounds up — a discount cannot increase the price', () => {
    // 1 unit at 50% off floors to 0, never 1.
    expect(applyPercentOff(1n, 50)).toBe(0n);
    expect(applyPercentOff(3n, 50)).toBe(1n);
  });

  it('handles the boundaries', () => {
    expect(applyPercentOff(1_000n, 0)).toBe(1_000n);
    expect(applyPercentOff(1_000n, 100)).toBe(0n);
  });

  it('rejects a fractional percentage rather than approximating it', () => {
    expect(() => applyPercentOff(1_000n, 12.5)).toThrow(RangeError);
  });
});

describe('usdToAssetUnits', () => {
  it('converts USD to microALGO at a given ALGO/USD rate', () => {
    // $1.00 at $0.25/ALGO = 4 ALGO = 4_000_000 microALGO
    const usd = parseDecimal('1.00', USD_DECIMALS);
    const rate = parseDecimal('0.25', USD_DECIMALS);
    expect(usdToAssetUnits(usd, USD_DECIMALS, rate, USD_DECIMALS, ALGO_DECIMALS)).toBe(4_000_000n);
  });

  it('rounds UP so the payer never underpays', () => {
    // $1.00 at $0.30/ALGO = 3.3333… ALGO — must not truncate below the price.
    const usd = parseDecimal('1.00', USD_DECIMALS);
    const rate = parseDecimal('0.30', USD_DECIMALS);
    const units = usdToAssetUnits(usd, USD_DECIMALS, rate, USD_DECIMALS, ALGO_DECIMALS);
    expect(units).toBe(3_333_334n);
    // Paying that many units covers the asking price.
    expect(units * rate >= usd * 1_000_000n).toBe(true);
  });

  it('refuses a non-positive price rather than dividing by zero', () => {
    expect(() => usdToAssetUnits(1n, 6, 0n, 6, 6)).toThrow(RangeError);
    expect(() => usdToAssetUnits(1n, 6, -1n, 6, 6)).toThrow(RangeError);
  });
});
