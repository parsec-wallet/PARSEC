import { describe, it, expect } from 'vitest';
import { arioToMario, marioToArio, assertMario, marioToNumber } from '../units';
import { MIN_OPERATOR_STAKE_ARIO } from '../constants';

describe('permaweb units', () => {
  it('converts whole and fractional ARIO to mARIO', () => {
    expect(arioToMario('20000')).toBe(20_000_000_000n);
    expect(arioToMario('0.5')).toBe(500_000n);
    expect(arioToMario(20000n)).toBe(20_000_000_000n);
    expect(arioToMario(1.25)).toBe(1_250_000n);
  });
  it('rejects more than 6 decimals and negatives', () => {
    expect(() => arioToMario('1.1234567')).toThrow();
    expect(() => arioToMario(-1)).toThrow();
  });
  it('round-trips through marioToArio', () => {
    expect(marioToArio(arioToMario('100152.172683'))).toBe('100152.172683');
    expect(marioToArio(20_000_000_000n)).toBe('20000');
  });
  it('assertMario catches an un-converted whole-ARIO stake', () => {
    expect(() => assertMario(20_000n, 'operatorStake', MIN_OPERATOR_STAKE_ARIO)).toThrow(/whole ARIO/);
    expect(() => assertMario(20_000_000_000n, 'operatorStake', MIN_OPERATOR_STAKE_ARIO)).not.toThrow();
    expect(() => assertMario(19_999_999_999n, 'operatorStake', MIN_OPERATOR_STAKE_ARIO)).toThrow();
  });
  it('marioToNumber refuses unsafe integers', () => {
    expect(marioToNumber(20_000_000_000n)).toBe(20_000_000_000);
    expect(() => marioToNumber(2n ** 60n)).toThrow();
  });
});
