// The external-signer seam: signDataItemWith must produce items identical in shape to
// signDataItem and verify under the same rules, because on desktop the signature comes from Rust
// (`chain_ar_sign`) and only the deep-hash ever leaves JS. A throwaway RSA-4096 key from WebCrypto
// stands in for the vault key (seconds, not the ~20 s mnemonic derivation).

import { beforeAll, describe, expect, it } from 'vitest';
import { estimateDataItemSize, signDataItem, signDataItemWith, verifyDataItem, type DataItemInput } from '../ans104';

let jwk: JsonWebKey;
let signingKey: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-PSS', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  signingKey = pair.privateKey;
}, 60_000);

/** Stand-in for the Rust command: receives the deep-hash, returns only a signature. */
async function externalSigner(sigData: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, signingKey, sigData as unknown as BufferSource);
  return new Uint8Array(sig);
}

function input(extra: Partial<DataItemInput> = {}): DataItemInput {
  return { owner: jwk.n!, data: 'hello permaweb', tags: [{ name: 'Content-Type', value: 'text/plain' }], ...extra };
}

describe('signDataItemWith', () => {
  it('produces an item that verifies, from a signer that never sees the key', async () => {
    const item = await signDataItemWith(input(), externalSigner);
    expect(item.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifyDataItem(item.raw)).toBe(true);
  });

  it('is layout-identical to signDataItem (same length, same owner)', async () => {
    const a = await signDataItem(input(), jwk);
    const b = await signDataItemWith(input(), externalSigner);
    expect(b.raw.length).toBe(a.raw.length);
    expect(b.owner).toBe(a.owner);
    expect(await verifyDataItem(a.raw)).toBe(true);
  });

  it('rejects a signer that returns the wrong length', async () => {
    await expect(signDataItemWith(input(), async () => new Uint8Array(256))).rejects.toThrow(/signature length/);
  });

  it('does not verify when the signer signed something else', async () => {
    const liar = async (): Promise<Uint8Array> => externalSigner(new TextEncoder().encode('not the deep hash'));
    const item = await signDataItemWith(input(), liar);
    expect(await verifyDataItem(item.raw)).toBe(false);
  });
});

describe('estimateDataItemSize', () => {
  it('equals the signed byte length — no tags, with tags, with target and anchor', async () => {
    const target = 'T'.repeat(43);
    const anchor = 'A'.repeat(43);
    const cases: DataItemInput[] = [
      input({ tags: [] }),
      input(),
      input({ target, anchor, data: new Uint8Array(4096) }),
    ];
    for (const c of cases) {
      const signed = await signDataItemWith(c, externalSigner);
      const dataLength = typeof c.data === 'string' ? new TextEncoder().encode(c.data).length : c.data.length;
      expect(estimateDataItemSize({ dataLength, tags: c.tags, target: !!c.target, anchor: !!c.anchor })).toBe(signed.raw.length);
    }
  });
});
