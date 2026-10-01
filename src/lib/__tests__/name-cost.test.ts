import { describe, it, expect } from 'vitest';
import { formatNameCost, groupThousands, marioToUsdMicro } from '../names/cost-display';

describe('name prices as people read them', () => {
  it('formats mARIO as ARIO, exactly, with thousands grouped', () => {
    // 3504218340 mARIO is 3,504.21834 ARIO — not three billion
    expect(formatNameCost(3_504_218_340n, 'ARIO', null)).toBe('3,504.21834 ARIO');
    expect(formatNameCost(62_575_327_500n, 'ARIO', null)).toBe('62,575.3275 ARIO');
  });

  it('adds the dollar value, rounded up to the cent (ARIO $0.00143892, 2026-10-01)', () => {
    const rate = 1_439n; // micro-USD per ARIO
    expect(marioToUsdMicro(3_504_218_340n, rate)).toBe(5_042_571n); // 5,042,570.19 rounded up
    expect(formatNameCost(3_504_218_340n, 'ARIO', rate)).toBe('3,504.21834 ARIO (≈ $5.05)');
  });

  it('leaves other units alone', () => {
    expect(formatNameCost(500_000n, 'microALGO')).toBe('500000 microALGO');
    expect(groupThousands('1234567.89')).toBe('1,234,567.89');
  });
});
