// ANS-104 DataItem round-trip tests. RSA-4096 derivation is expensive
// (~20s), so we share one JWK across the suite — same approach as tx.test.ts.

import { describe, expect, it, beforeAll } from 'vitest';
import { deriveJwkFromMnemonic } from '../seed';
import { addressFromJwk, base64urlToBytes, bytesToBase64url, type ArweaveJwk } from '../jwk';
import {
  decodeDataItemAsync,
  decodeTags,
  encodeTags,
  signDataItem,
  verifyDataItem,
  type DataItemInput,
} from '../ans104';

const FIXTURE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

let JWK: ArweaveJwk;
let JWK_ADDRESS: string;

beforeAll(async () => {
  JWK = (await deriveJwkFromMnemonic(FIXTURE_MNEMONIC)) as ArweaveJwk;
  JWK_ADDRESS = await addressFromJwk(JWK);
}, 120_000);

describe('encodeTags / decodeTags', () => {
  it('round-trips a typical AO tag set', () => {
    const tags = [
      { name: 'App-Name', value: 'parsec-test' },
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Action', value: 'Transfer' },
    ];
    const encoded = encodeTags(tags);
    expect(encoded.byteLength).toBeGreaterThan(0);
    const decoded = decodeTags(encoded);
    expect(decoded).toEqual(tags);
  });

  it('encodes empty tag list as zero bytes', () => {
    expect(encodeTags([]).byteLength).toBe(0);
    expect(decodeTags(new Uint8Array(0))).toEqual([]);
  });
});

describe('signDataItem', () => {
  it('produces a 512-byte signature and a 43-char id', async () => {
    const input: DataItemInput = {
      owner: JWK.n!,
      tags: [{ name: 'App-Name', value: 'parsec-test' }],
      data: new TextEncoder().encode('hello AO'),
    };
    const signed = await signDataItem(input, JWK);

    expect(base64urlToBytes(signed.signature).byteLength).toBe(512);
    expect(signed.id.length).toBe(43);
    expect(/^[A-Za-z0-9_-]{43}$/.test(signed.id)).toBe(true);

    // id == SHA-256(signature) base64url
    const idHash = await crypto.subtle.digest(
      'SHA-256',
      base64urlToBytes(signed.signature) as unknown as BufferSource,
    );
    expect(bytesToBase64url(new Uint8Array(idHash))).toBe(signed.id);
  });

  it('verifies round-trip via verifyDataItem()', async () => {
    const signed = await signDataItem(
      {
        owner: JWK.n!,
        tags: [{ name: 'Action', value: 'Eval' }],
        data: new TextEncoder().encode('42'),
      },
      JWK,
    );
    expect(await verifyDataItem(signed.raw)).toBe(true);
  });

  it('decodes the binary back into the same fields', async () => {
    const tags = [
      { name: 'App-Name', value: 'parsec-test' },
      { name: 'Type', value: 'Message' },
    ];
    const data = new TextEncoder().encode('payload');
    const signed = await signDataItem({ owner: JWK.n!, tags, data }, JWK);

    const parsed = await decodeDataItemAsync(signed.raw);
    expect(parsed.owner).toBe(JWK.n);
    expect(parsed.tags).toEqual(tags);
    expect(Array.from(parsed.data)).toEqual(Array.from(data));
    expect(parsed.id).toBe(signed.id);
  });

  it('rejects when owner does not match the JWK', async () => {
    const bogusOwner = JWK.n!.startsWith('A') ? 'B' + JWK.n!.slice(1) : 'A' + JWK.n!.slice(1);
    await expect(
      signDataItem({ owner: bogusOwner, data: new TextEncoder().encode('x') }, JWK),
    ).rejects.toThrow(/does not match/);
  });

  it('JWK address derivation is stable across the suite', () => {
    expect(JWK_ADDRESS).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
