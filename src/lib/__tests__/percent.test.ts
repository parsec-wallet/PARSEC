import { describe, it, expect } from 'vitest';
import {
  formatPercent, formatChange, describeChange, displaySign, isFlat, UNKNOWN,
} from '../percent';

describe('percentage formatting', () => {
  it('never prints a minus sign on a zero', () => {
    // The bug this module exists to prevent: toFixed(1) on -0.04 gives "-0.0",
    // and prefixing a sign from the raw value gives "-0.0%".
    expect(formatPercent(-0.04)).toBe('0.0%');
    expect(formatPercent(-0.0001)).toBe('0.0%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(0.04)).toBe('0.0%');
    for (const v of [-0.04, -0.0001, 0, 0.04]) {
      expect(formatPercent(v).startsWith('-')).toBe(false);
      expect(formatPercent(v).startsWith('+')).toBe(false);
    }
  });

  it('takes the sign from the rounded value, not the raw one', () => {
    expect(displaySign(-0.04, 1)).toBe('');
    expect(displaySign(-0.06, 1)).toBe('-');
    expect(displaySign(0.06, 1)).toBe('+');
    // At higher precision the same value is no longer flat.
    expect(displaySign(-0.04, 2)).toBe('-');
  });

  it('renders an unknown as a dash, never as zero', () => {
    // A change we have not observed is not a flat market.
    expect(formatPercent(null)).toBe(UNKNOWN);
    expect(formatPercent(NaN)).toBe(UNKNOWN);
    expect(formatPercent(Infinity)).toBe(UNKNOWN);
    expect(formatPercent(null)).not.toBe('0.0%');
  });

  it('formats ordinary moves with a sign and fixed precision', () => {
    expect(formatPercent(5)).toBe('+5.0%');
    expect(formatPercent(-8.44)).toBe('-8.4%');
    expect(formatPercent(-8.46)).toBe('-8.5%');
    expect(formatPercent(0.15, 2)).toBe('+0.15%');
    expect(formatPercent(-12.345, 2)).toBe('-12.35%');
  });

  it('is symmetric: the same magnitude formats identically either way', () => {
    for (const v of [0.5, 1, 3.14159, 12.5, 99.99]) {
      expect(formatPercent(v).slice(1)).toBe(formatPercent(-v).slice(1));
      expect(formatPercent(v)[0]).toBe('+');
      expect(formatPercent(-v)[0]).toBe('-');
    }
  });

  it('attaches the period when asked', () => {
    expect(formatChange(5, '24h')).toBe('+5.0% 24h');
    expect(formatChange(-1.2, '1h')).toBe('-1.2% 1h');
    expect(formatChange(null, '15m')).toBe('— 15m');
  });

  it('describes a change in words, including an unknown', () => {
    expect(describeChange('AAVE', 5, '24h')).toBe('AAVE +5.00% over 24h');
    expect(describeChange('STX', null, '15m')).toContain('not yet known');
  });

  it('reports the real observed span for a derived figure', () => {
    // The fifteen-minute change is computed from our own samples, so the true
    // span depends on when they landed. Claiming a round 15 would be a small
    // lie about the one number the participant might act on quickly.
    expect(describeChange('BTC', 1.5, '15m', 19)).toContain('over 19 minutes');
    expect(describeChange('BTC', 1.5, '15m', 13.4)).toContain('over 13 minutes');
  });

  it('knows what counts as flat at a given precision', () => {
    expect(isFlat(0.04, 1)).toBe(true);
    expect(isFlat(0.06, 1)).toBe(false);
    expect(isFlat(0.04, 2)).toBe(false);
    expect(isFlat(null)).toBe(false); // unknown is not flat
  });
});
