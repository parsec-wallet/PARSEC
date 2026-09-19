import { describe, it, expect } from 'vitest';
import { strengthOf, WEAK_AT_OR_BELOW, STRONG_AT } from '../passphrase-field';

describe('passphrase strength bands', () => {
  it('flags 6 characters or fewer as weak', () => {
    for (let n = 1; n <= 6; n++) {
      expect(strengthOf('x'.repeat(n))).toBe('weak');
    }
  });

  it('treats 7 to 11 characters as medium', () => {
    for (let n = 7; n <= 11; n++) {
      expect(strengthOf('x'.repeat(n))).toBe('medium');
    }
  });

  it('treats 12 or more characters as strong', () => {
    for (const n of [12, 13, 20, 64]) {
      expect(strengthOf('x'.repeat(n))).toBe('strong');
    }
  });

  it('exposes the thresholds it mirrors from Rust', () => {
    // These must stay in step with WEAK_PASSPHRASE_LEN / STRONG_PASSPHRASE_LEN
    // in bankon_vault::overseer, which is the authority.
    expect(WEAK_AT_OR_BELOW).toBe(6);
    expect(STRONG_AT).toBe(12);
  });

  it('counts code points, not UTF-16 units', () => {
    // Twelve emoji are twelve characters, not twenty-four.
    expect(strengthOf('😀'.repeat(12))).toBe('strong');
    expect(strengthOf('😀'.repeat(6))).toBe('weak');
  });

  it('bands the empty string as weak rather than throwing', () => {
    expect(strengthOf('')).toBe('weak');
  });
});
