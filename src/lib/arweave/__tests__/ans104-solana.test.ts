// ANS-104 signature type 4 (Solana): the item a Solana key signs for Turbo. Checked against
// @dha-team/arbundles itself (the library @ardrive/turbo-sdk signs with), so a byte that differs
// from what Turbo expects fails here, not on mainnet.

import { describe, expect, it } from 'vitest';
import { DataItem } from '@dha-team/arbundles';
import { bytesToBase64url } from '../jwk';
import {
  SIG_TYPE_SOLANA,
  decodeDataItemAsync,
  estimateDataItemSize,
  signDataItemWith,
  solanaSigningMessage,
  verifyDataItem,
} from '../ans104';
import { planUpload, turboTokenFor } from '../turbo';

async function ed25519(): Promise<{ owner: string; sign: (m: Uint8Array) => Promise<Uint8Array> }> {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return {
    owner: bytesToBase64url(pub),
    sign: async (m) => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, m as unknown as BufferSource)),
  };
}

const TAGS = [{ name: 'Content-Type', value: 'text/html' }, { name: 'App-Name', value: 'Parsec' }];

describe('ANS-104 type 4 (Solana)', () => {
  it('signs the hex of the deep-hash and verifies — ours and arbundles agree', async () => {
    const k = await ed25519();
    const item = await signDataItemWith(
      { owner: k.owner, sigType: SIG_TYPE_SOLANA, tags: TAGS, data: '<!doctype html><h1>spintrade</h1>' },
      (sigData) => k.sign(solanaSigningMessage(sigData)),
    );
    expect(item.raw[0] | (item.raw[1] << 8)).toBe(4);
    expect(await verifyDataItem(item.raw)).toBe(true);

    const theirs = new DataItem(Buffer.from(item.raw));
    expect(theirs.signatureType).toBe(4);
    expect(theirs.id).toBe(item.id);
    expect(await DataItem.verify(Buffer.from(item.raw))).toBe(true);

    const decoded = await decodeDataItemAsync(item.raw);
    expect(decoded.owner).toBe(k.owner);
    expect(decoded.tags).toEqual(TAGS);
  });

  it('a tampered item does not verify', async () => {
    const k = await ed25519();
    const item = await signDataItemWith(
      { owner: k.owner, sigType: SIG_TYPE_SOLANA, data: 'x' },
      (sigData) => k.sign(solanaSigningMessage(sigData)),
    );
    const bad = item.raw.slice();
    bad[bad.length - 1] ^= 1;
    expect(await verifyDataItem(bad)).toBe(false);
  });

  it('a signature over the raw hash (not its hex) is refused by the network check', async () => {
    const k = await ed25519();
    const item = await signDataItemWith({ owner: k.owner, sigType: SIG_TYPE_SOLANA, data: 'x' }, (sigData) => k.sign(sigData));
    expect(await DataItem.verify(Buffer.from(item.raw))).toBe(false);
  });

  it('sizes exactly, and routes to the solana token so the address credits pay', async () => {
    const k = await ed25519();
    const data = new Uint8Array(1234);
    const item = await signDataItemWith({ owner: k.owner, sigType: SIG_TYPE_SOLANA, tags: TAGS, data }, (s) => k.sign(solanaSigningMessage(s)));
    expect(estimateDataItemSize({ dataLength: data.length, tags: TAGS, sigType: SIG_TYPE_SOLANA })).toBe(item.raw.length);
    expect(turboTokenFor(item.raw)).toBe('solana');

    const files = [{ path: 'index.html', bytes: data, contentType: 'text/html' }];
    const ar = planUpload(files, 107_520);
    const sol = planUpload(files, 107_520, { sigType: SIG_TYPE_SOLANA });
    expect(ar.totalBytes - sol.totalBytes).toBe((512 + 512) - (64 + 32));   // 928 bytes lighter per item
  });
});
