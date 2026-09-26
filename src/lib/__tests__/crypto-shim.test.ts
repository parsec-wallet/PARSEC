// The Node `crypto` alias must provide what @ar.io/sdk imports (createHash, randomBytes).

import { describe, it, expect } from 'vitest';
import { randomBytes, createHash } from '../algorand-hd/crypto-shim';

describe('crypto-shim randomBytes', () => {
  it('returns the requested length', () => {
    for (const n of [0, 1, 32, 65536, 65537, 200_000]) expect(randomBytes(n).length).toBe(n);
  });

  it('is not constant and fills past the 64 KiB WebCrypto chunk', () => {
    expect(Buffer.from(randomBytes(32)).equals(Buffer.from(randomBytes(32)))).toBe(false);
    const big = randomBytes(65536 * 2 + 10);
    const tail = big.subarray(65536 * 2);
    expect(tail.some((b) => b !== 0)).toBe(true);
  });

  it('rejects invalid sizes', () => {
    expect(() => randomBytes(-1)).toThrow(RangeError);
    expect(() => randomBytes(1.5)).toThrow(RangeError);
  });

  it('supports the callback form', async () => {
    const buf = await new Promise<Uint8Array>((res, rej) => randomBytes(16, (e, b) => (e ? rej(e) : res(b))));
    expect(buf.length).toBe(16);
  });

  it('keeps createHash intact', () => {
    expect(Buffer.from(createHash('sha256').update('abc').digest()).toString('hex'))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
