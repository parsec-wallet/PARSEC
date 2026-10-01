import { describe, it, expect } from 'vitest';
import { usdRateMicro, winstonToUsdMicro, wincToUsdMicro, x402ItemEstimate } from '../permaweb/storage-cost';
import { bankonFee } from '../bankon-fee';
import { UploadBudget } from '../arweave/turbo-x402';

describe('storage prices, exactly', () => {
  it('converts winston at an AR price, rounding up (live figures, 2026-10-01)', () => {
    // 1 MB on Arweave: 13,045,356,152 winston at AR $4.26 → $0.0555732, rounded up
    expect(winstonToUsdMicro(13_045_356_152n, usdRateMicro(4.26)!)).toBe(55_574n); // 55,573.2 rounded up
  });

  it('converts winc at Turbo\'s published rate', () => {
    const rates = { wincPerGiB: 13_317_679_354_470n, usdMicroPerGiB: usdRateMicro(87.155670855083)! };
    // 1 MB at Turbo: 12,407,757,067 winc → ≈ $0.0812
    expect(wincToUsdMicro(12_407_757_067n, rates)).toBe(81_201n);
  });

  it('applies Turbo\'s one-cent minimum per x402 item', () => {
    expect(x402ItemEstimate(800n)).toBe(10_000n);
    expect(x402ItemEstimate(82_783n)).toBe(82_783n);
  });

  it('BANKON fee: 10 %, at least $0.05', () => {
    expect(bankonFee(82_783n)).toBe(50_000n);
    expect(bankonFee(5_000_000n)).toBe(500_000n);
  });

  it('refuses an unusable market price rather than inventing one', () => {
    expect(usdRateMicro(null)).toBeNull();
    expect(usdRateMicro(0)).toBeNull();
    expect(usdRateMicro(Number.NaN)).toBeNull();
  });
});

describe('an upload never pays past what was approved', () => {
  it('reserves within the budget and refuses beyond it', () => {
    const b = new UploadBudget(100_000n);
    b.take(60_000n);
    expect(() => b.take(50_000n)).toThrow(/approved/);
    expect(b.spentMicro).toBe(60_000n);
    b.release(60_000n);
    b.take(100_000n);
    expect(b.spentMicro).toBe(100_000n);
  });
});
