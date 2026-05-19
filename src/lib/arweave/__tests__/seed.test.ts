// Determinism + shape tests for the BIP-39 → RSA-4096 derivation.
// RSA-4096 generation is slow (~10–30s in this VM), so each test that
// derives a real key bumps the timeout. We assert that the same input
// produces the same key, and that the output is a well-formed JWK whose
// public modulus yields a valid 43-char Arweave address.

import { describe, expect, it } from 'vitest';
import { deriveJwkFromMnemonic } from '../seed';
import { addressFromJwk, isArweaveAddress, isArweaveJwk } from '../jwk';

const FIXTURE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

describe('deriveJwkFromMnemonic', () => {
  it('produces a well-formed Arweave RSA-4096 JWK', { timeout: 120_000 }, async () => {
    const jwk = await deriveJwkFromMnemonic(FIXTURE_MNEMONIC);
    expect(isArweaveJwk(jwk)).toBe(true);
    expect(jwk.kty).toBe('RSA');
    // RSA-4096 public modulus is 512 bytes → base64url ≈ 683 chars
    expect(jwk.n!.length).toBeGreaterThan(680);
    expect(jwk.n!.length).toBeLessThan(690);
    const address = await addressFromJwk(jwk);
    expect(isArweaveAddress(address)).toBe(true);
  });

  it('is deterministic for the same mnemonic + passphrase', { timeout: 240_000 }, async () => {
    const [jwkA, jwkB] = await Promise.all([
      deriveJwkFromMnemonic(FIXTURE_MNEMONIC),
      deriveJwkFromMnemonic(FIXTURE_MNEMONIC),
    ]);
    expect(jwkA.n).toBe(jwkB.n);
    expect(jwkA.d).toBe(jwkB.d);
    expect(jwkA.p).toBe(jwkB.p);
    expect(jwkA.q).toBe(jwkB.q);
  });

  it('rejects invalid mnemonics before doing any work', async () => {
    await expect(deriveJwkFromMnemonic('not a real mnemonic phrase'))
      .rejects.toThrow(/Invalid BIP-39 mnemonic/);
  });
});
