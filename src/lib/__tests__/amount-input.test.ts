import { describe, it, expect } from 'vitest';
import { normalizeAmountInput, parseDecimal } from '../money';

describe('amounts as people type them', () => {
  it('accepts a decimal point or a decimal comma', () => {
    expect(normalizeAmountInput('1.5')).toBe('1.5');
    expect(normalizeAmountInput('1,5')).toBe('1.5');
    expect(normalizeAmountInput(' 0,000001 ')).toBe('0.000001');
    expect(normalizeAmountInput('.5')).toBe('.5');
    expect(normalizeAmountInput('12.')).toBe('12');
    expect(normalizeAmountInput('1 000')).toBe('1000');
  });

  it('refuses what could be read two ways, or is not a number', () => {
    for (const bad of ['1,000.5', '1.000,5', '1,2,3', '1.2.3', '', '-1', '1e3', 'abc', '0x10']) {
      expect(normalizeAmountInput(bad)).toBeNull();
    }
  });

  it('a decimal comma reaches base units exactly (1,5 ALGO is 1.5, not 1)', () => {
    expect(parseDecimal(normalizeAmountInput('1,5')!, 6)).toBe(1_500_000n);
  });
});
