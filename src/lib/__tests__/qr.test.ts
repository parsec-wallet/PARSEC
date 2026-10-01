// The QR encoder is checked module-for-module against the `qrcode` package
// (present in node_modules as a transitive dependency; used here only as a test
// oracle, never shipped). Same text, version, level M and mask → same grid.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { encodeQr, versionFor } from '../qr';

const ORACLE = path.join(process.cwd(), 'node_modules/.pnpm/qrcode@1.5.3/node_modules/qrcode');
const have = existsSync(ORACLE);
const ref = have ? createRequire(import.meta.url)(ORACLE) as {
  create(text: string | { data: string; mode: string }[], o: { errorCorrectionLevel: string; version?: number; maskPattern?: number }): { version: number; modules: { size: number; data: Uint8Array } };
} : null;

const SAMPLES = [
  'QJONDX5BPEJHX5D46X26B67HQVYC6KSLR4ZGRXP53POKVVF32VQ7W3Y6SU',
  'algorand://QJONDX5BPEJHX5D46X26B67HQVYC6KSLR4ZGRXP53POKVVF32VQ7W3Y6SU?amount=1500000&asset=31566704',
  'a',
  '0x52908400098527886E0F7030069857D2E4169EE7',
  'x'.repeat(200),
];

describe.skipIf(!have)('encodeQr matches the reference encoder', () => {
  for (const text of SAMPLES) {
    for (const mask of [0, 3, 5, 7]) {
      it(`${text.slice(0, 24)}… mask ${mask}`, () => {
        const mine = encodeQr(text, { forceMask: mask });
        const theirs = ref!.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'M', version: mine.version, maskPattern: mask });
        expect(theirs.version).toBe(mine.version);
        const size = theirs.modules.size;
        expect(mine.size).toBe(size);
        const flat = mine.modules.flat().map((v) => (v ? 1 : 0));
        expect(flat).toEqual(Array.from(theirs.modules.data, (v) => (v ? 1 : 0)));
      });
    }
  }
});

describe('encodeQr', () => {
  it('picks the smallest version and refuses what does not fit', () => {
    expect(versionFor(14)).toBe(1);
    expect(versionFor(15)).toBe(2);
    expect(versionFor(213)).toBe(10);
    expect(versionFor(214)).toBeNull();
    expect(() => encodeQr('x'.repeat(300))).toThrow(/Too long/);
  });

  it('chooses a mask by penalty when none is forced', () => {
    const c = encodeQr('PARSEC');
    expect(c.mask).toBeGreaterThanOrEqual(0);
    expect(c.mask).toBeLessThan(8);
    expect(c.size).toBe(21);
  });
});
