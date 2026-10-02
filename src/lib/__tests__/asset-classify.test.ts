// 0.3.2: verified only by id; a disguised copy of a listed asset is always a lookalike.
import { describe, it, expect } from 'vitest';
import { classifyAsset, foldTicker } from '../algorand/asset-classify';
import { standardAssets } from '../algorand/asset-whitelist';

describe('foldTicker', () => {
  it('reads disguised tickers the way a glance would', () => {
    for (const s of ['USDC', 'usdc', 'ＵＳＤＣ', 'U S D C', 'U.S.D.C', 'US​DC', 'UЅDС', 'ÚSDC', 'U$DC', 'U-SDC', 'u5dc']) {
      expect(foldTicker(s), s).toBe(foldTicker('USDC'));
    }
    expect(foldTicker('G0BTC')).toBe(foldTicker('goBTC'));
    expect(foldTicker('TlNY')).toBe(foldTicker('TINY'));
  });

  it('keeps genuinely different tickers apart', () => {
    expect(foldTicker('USDT')).not.toBe(foldTicker('USDC'));
    expect(foldTicker('goETH')).not.toBe(foldTicker('goBTC'));
    expect(foldTicker('DAI')).not.toBe(foldTicker('USDC'));
  });
});

describe('classifyAsset', () => {
  it('verifies by id, and only when a known creator matches', () => {
    expect(classifyAsset('mainnet', { assetId: 31566704, unitName: 'USDC', name: 'USDC' }).kind).toBe('verified');
    expect(classifyAsset('mainnet', {
      assetId: 31566704, unitName: 'USDC', name: 'USDC', creator: '2UEQTE5QDNXPI7M3TU44G6SYKLFWLPQO7EBZM7K7MHMQQMFI4QJPLHQFHM',
    }).kind).toBe('verified');
    expect(classifyAsset('mainnet', { assetId: 31566704, unitName: 'USDC', name: 'USDC', creator: 'SOMEONEELSE' }).kind).not.toBe('verified');
  });

  it('calls out a copy by unit or by name, and leaves an honest stranger unverified', () => {
    const byUnit = classifyAsset('mainnet', { assetId: 4242, unitName: 'UЅDС', name: 'Free money' });
    expect(byUnit).toMatchObject({ kind: 'lookalike', by: 'unit' });
    expect(byUnit.kind === 'lookalike' && byUnit.of.assetId).toBe(31566704);
    expect(classifyAsset('mainnet', { assetId: 4243, unitName: 'XYZ', name: 'Tether USDt' })).toMatchObject({ kind: 'lookalike', by: 'name' });
    expect(classifyAsset('mainnet', { assetId: 4244, unitName: 'PRSC', name: 'Parsec Points' }).kind).toBe('unverified');
  });

  it('never verifies a disguised copy of any listed asset (property, 40 disguises each)', () => {
    // Deterministic PRNG so a failure reproduces.
    let seed = 0x5eed;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const LATIN_TO_LOOKALIKE: Record<string, string[]> = {
      a: ['а', 'α'], c: ['с'], e: ['е', 'ε'], o: ['о', 'ο', '0'], p: ['р', 'ρ'], s: ['ѕ', '5', '$'],
      x: ['х', 'χ'], y: ['у'], i: ['і', '1', 'l'], l: ['1', 'I', '|'], b: ['в'], k: ['к', 'κ'], t: ['т', 'τ'],
      h: ['н'], m: ['м'], n: ['Ν'],
    };
    const fullwidth = (ch: string) => (/[!-~]/.test(ch) ? String.fromCharCode(ch.charCodeAt(0) + 0xfee0) : ch);
    const disguise = (s: string): string => [...s].map((ch) => {
      const r = rnd();
      const subs = LATIN_TO_LOOKALIKE[ch.toLowerCase()];
      if (r < 0.25 && subs) return subs[Math.floor(rnd() * subs.length)];
      if (r < 0.35) return fullwidth(ch);
      if (r < 0.45) return ch + '​';
      if (r < 0.55) return ch + ' ';
      if (r < 0.62) return ch + '.';
      return rnd() < 0.5 ? ch.toUpperCase() : ch.toLowerCase();
    }).join('');

    let checked = 0;
    for (const a of standardAssets('mainnet')) {
      for (let k = 0; k < 40; k++) {
        const fake = { assetId: 9_000_000_000 + checked, unitName: disguise(a.unitName), name: disguise(a.name) };
        const c = classifyAsset('mainnet', fake);
        expect(c.kind, `${JSON.stringify(fake)} disguises ${a.unitName}`).toBe('lookalike');
        checked++;
      }
    }
    expect(checked).toBe(standardAssets('mainnet').length * 40);
  });
});
