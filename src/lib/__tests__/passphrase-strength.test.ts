import { describe, it, expect } from 'vitest';
import { assessPassphrase } from '../passphrase-strength';

const level = (p: string) => assessPassphrase(p).level;

describe('assessPassphrase', () => {
  it('rates common passwords very weak, however decorated', () => {
    for (const p of ['password', 'Password1!', 'p4ssw0rd123', 'P@ssword!', '12345678', 'qwertyuiop', 'bitcoin123']) {
      expect(level(p), p).toBe(0);
    }
  });

  it('sees through the common patterns', () => {
    expect(level('Summer2024')).toBeLessThanOrEqual(1);       // capital first, year last
    expect(level('aaaaaaaaaa')).toBe(0);                      // repeats
    expect(level('abcdefgh')).toBe(0);                        // sequence
    expect(level('Tr0ub4dor&3')).toBeLessThanOrEqual(2);      // look-alike swaps
    expect(level('MyDogSpot2019!')).toBeLessThanOrEqual(2);   // capitalised words run together
  });

  it('credits several unrelated words per word', () => {
    expect(level('correct horse battery staple')).toBe(2);
    expect(level('orbit-velvet-cabin-thunder-mosaic-lantern')).toBeGreaterThanOrEqual(3);
    expect(assessPassphrase('one two three four').warnings).toEqual([]);
    expect(assessPassphrase('moon moon moon moon').warnings[0]).toMatch(/repeated word/i);
  });

  it('rates a long random string strong', () => {
    expect(level('x7#Kq9!mZ2pL')).toBeGreaterThanOrEqual(3);
  });

  it('says when the vault minimum is not met', () => {
    expect(assessPassphrase('hunter2').hint).toMatch(/at least 8/);
  });

  it('handles the empty string and non-ASCII', () => {
    expect(assessPassphrase('')).toMatchObject({ level: 0, bits: 0, hint: '' });
    expect(assessPassphrase('日本語のパスフレーズです').bits).toBeGreaterThan(60);
  });
});
