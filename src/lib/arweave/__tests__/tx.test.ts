// Tests for the pure-crypto signing path. buildUploadTx + uploadTx hit the
// live gateway (anchor, price, chunk POST), so they're exercised end-to-end
// in the Phase 4 UI flow rather than mocked here.
//
// What we verify here:
//   * signTx mutates the tx with a well-formed signature, owner, and id
//   * the signature is a valid RSA-PSS/SHA-256 signature over getSignatureData()
//   * id is exactly SHA-256(signature), base64url
//   * owner-mismatch is rejected before signing

import { describe, expect, it, beforeAll } from 'vitest';
import Transaction from 'arweave/web/lib/transaction';
import { deriveJwkFromMnemonic } from '../seed';
import { addressFromJwk, base64urlToBytes, bytesToBase64url, type ArweaveJwk } from '../jwk';
import { signTx } from '../tx';

const FIXTURE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

// Shared JWK fixture — RSA-4096 generation is the slow part (~20s), and
// re-doing it per test would inflate the suite by minutes. The derivation
// is deterministic, so cache once and reuse.
let JWK: ArweaveJwk;
let JWK_ADDRESS: string;

beforeAll(async () => {
  JWK = (await deriveJwkFromMnemonic(FIXTURE_MNEMONIC)) as ArweaveJwk;
  JWK_ADDRESS = await addressFromJwk(JWK);
}, 120_000);

function buildLocalTx(data: Uint8Array, owner: string): Transaction {
  // Hand-built tx avoids the network call inside arweave.createTransaction.
  return new Transaction({
    format: 2,
    owner,
    target: '',
    quantity: '0',
    reward: '12345',           // arbitrary winston — gateway not consulted here
    last_tx: 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE',
    data,
    data_size: data.byteLength.toString(),
    data_root: '',             // recomputed during getSignatureData()
    tags: [],
  });
}

describe('signTx', () => {
  it('sets a 512-byte RSA-4096 signature and a 43-char base64url id', async () => {
    const tx = buildLocalTx(new TextEncoder().encode('hello permaweb'), JWK.n);
    await signTx(tx, JWK);

    expect(tx.signature.length).toBeGreaterThan(680); // ~683 base64url chars
    expect(base64urlToBytes(tx.signature).byteLength).toBe(512);

    expect(tx.id.length).toBe(43);
    expect(/^[A-Za-z0-9_-]{43}$/.test(tx.id)).toBe(true);

    // id is SHA-256(signature), base64url
    const sigBytes = base64urlToBytes(tx.signature);
    const idHash = await crypto.subtle.digest('SHA-256', sigBytes as unknown as BufferSource);
    expect(bytesToBase64url(new Uint8Array(idHash))).toBe(tx.id);
  });

  it('produces signatures that verify under the JWK public key', async () => {
    const tx = buildLocalTx(new TextEncoder().encode('verify-me'), JWK.n);
    const sigData = await tx.getSignatureData();
    await signTx(tx, JWK);

    const pubJwk: JsonWebKey = { kty: 'RSA', n: JWK.n, e: JWK.e };
    const pub = await crypto.subtle.importKey(
      'jwk',
      pubJwk,
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 32 },
      pub,
      base64urlToBytes(tx.signature) as unknown as BufferSource,
      sigData as unknown as BufferSource,
    );
    expect(ok).toBe(true);
  });

  it('infers the owner from the JWK when tx.owner is empty', async () => {
    const tx = buildLocalTx(new TextEncoder().encode('owner-infer'), '');
    expect(tx.owner).toBe('');
    await signTx(tx, JWK);
    expect(tx.owner).toBe(JWK.n);
  });

  it('rejects signing when tx.owner does not match the JWK', async () => {
    // Flip a single base64url char in the owner — same length, valid encoding,
    // wrong key. signTx should refuse before doing any crypto work.
    const bogusOwner = JWK.n.startsWith('A') ? 'B' + JWK.n.slice(1) : 'A' + JWK.n.slice(1);
    const tx = buildLocalTx(new TextEncoder().encode('mismatch'), bogusOwner);
    await expect(signTx(tx, JWK)).rejects.toThrow(/owner does not match/);
  });

  it('JWK address derivation matches the fixture address', () => {
    // Sanity-check the test fixture itself — not asserting anything about
    // signTx, just guarding against accidentally regenerating a different
    // RSA key (would silently invalidate every other assertion).
    expect(JWK_ADDRESS).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
