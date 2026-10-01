// Solana key derivation — known-answer test.
//
// The expected address was derived INDEPENDENTLY of PARSEC's code: Node's
// built-in crypto for SLIP-0010 ed25519, tweetnacl for the ed25519 public
// key, and @solana/web3.js for base58 — the canonical Phantom / Solflare
// pipeline (BIP-39 seed → m/44'/501'/0'/0', all hardened). If this passes,
// an external sender's wallet derives the same address PARSEC displays, so
// incoming SOL lands on an address PARSEC can actually spend.

import { describe, it, expect } from 'vitest';
import { deriveSolanaFromMnemonic } from '../seed';
import { isSolanaAddress } from '../address';

// Canonical BIP-39 test mnemonic.
const ABANDON =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// Independently-derived reference address at m/44'/501'/0'/0'.
const EXPECTED = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

describe('deriveSolanaFromMnemonic', () => {
  it('matches the canonical Phantom derivation (known-answer)', async () => {
    const kp = await deriveSolanaFromMnemonic(ABANDON);
    expect(kp.address).toBe(EXPECTED);
  });

  it('produces a valid base58 address and 32-byte keys', async () => {
    const kp = await deriveSolanaFromMnemonic(ABANDON);
    expect(isSolanaAddress(kp.address)).toBe(true);
    expect(kp.secretSeed.length).toBe(32);
    expect(kp.publicKey.length).toBe(32);
  });

  it('is deterministic', async () => {
    const a = await deriveSolanaFromMnemonic(ABANDON);
    const b = await deriveSolanaFromMnemonic(ABANDON);
    expect(b.address).toBe(a.address);
  });

  it('rejects an invalid mnemonic', async () => {
    await expect(deriveSolanaFromMnemonic('not a valid mnemonic')).rejects.toThrow();
  });
});
