import { describe, it, expect } from 'vitest';
import { isAlgoName, normalizeAlgoName, matchAccount } from '../login';
import type { WalletAccount } from '../../../types/wallet';

// mindx.algo's real owner address (58-char base32).
const MINDX = 'L24WEG3KK6QDSQGQGXCJIYR46HHDFK5IJ7HOZF3YDDTHTREGYPDWY74KG4';
const OTHER = 'CPVKAV6MACS65P3CLNZ43DR6YUC7O74FMIW7PGA373TVBORCX4IDARVOFQ';

function account(address: string, chains?: Record<string, string>): WalletAccount {
  return { address, name: 'Account', createdAt: 1, chains };
}

describe('isAlgoName', () => {
  it('accepts a bare label and a suffixed name', () => {
    expect(isAlgoName('mindx')).toBe(true);
    expect(isAlgoName('mindx.algo')).toBe(true);
    expect(isAlgoName('  MindX.Algo  ')).toBe(true);
  });

  it('does not treat a raw Algorand address as a name', () => {
    // Otherwise pasting an address would trigger a pointless NFD lookup.
    expect(isAlgoName(MINDX)).toBe(false);
  });

  it('rejects empty and clearly non-name input', () => {
    expect(isAlgoName('')).toBe(false);
    expect(isAlgoName('   ')).toBe(false);
    expect(isAlgoName('not a name!')).toBe(false);
  });
});

describe('normalizeAlgoName', () => {
  it('appends the suffix and lowercases', () => {
    expect(normalizeAlgoName('mindx')).toBe('mindx.algo');
    expect(normalizeAlgoName('MindX')).toBe('mindx.algo');
  });

  it('does not double the suffix', () => {
    expect(normalizeAlgoName('mindx.algo')).toBe('mindx.algo');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeAlgoName('  mindx.algo  ')).toBe('mindx.algo');
  });
});

describe('matchAccount', () => {
  it('finds the account a name points at', () => {
    const accounts = [account(OTHER), account(MINDX)];
    expect(matchAccount(accounts, [MINDX])).toBe(1);
  });

  it('matches through the per-chain map, not just the primary address', () => {
    // A recovered account may carry its Algorand address only in `chains`.
    const accounts = [account('SOMETHINGELSE', { algorand: MINDX })];
    expect(matchAccount(accounts, [MINDX])).toBe(0);
  });

  it('honours candidate order — the owner wins over a linked address', () => {
    const accounts = [account(OTHER), account(MINDX)];
    expect(matchAccount(accounts, [MINDX, OTHER])).toBe(1);
  });

  it('returns -1 when this device holds no key for the identity', () => {
    // The critical case: a name that resolves must still open nothing when
    // there is no local key for it.
    expect(matchAccount([account(OTHER)], [MINDX])).toBe(-1);
    expect(matchAccount([], [MINDX])).toBe(-1);
  });

  it('returns -1 for an identity with no candidate addresses', () => {
    expect(matchAccount([account(MINDX)], [])).toBe(-1);
  });
});
