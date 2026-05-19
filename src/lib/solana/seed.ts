// Solana key derivation — BIP-39 mnemonic → SLIP-0010 ed25519 child key.
//
// Path: m/44'/501'/0'/0'  (Phantom / Solflare convention, all-hardened).
// SLIP-0010 ed25519 only permits hardened derivation, so every path
// segment carries the high bit. The 32-byte child key is the ed25519
// secret seed; the 32-byte public key is derived via @noble/curves.

import * as bip39 from 'bip39';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58Encode } from './address';

const HARDENED_OFFSET = 0x80000000;
const SOLANA_PATH: number[] = [44, 501, 0, 0]; // m/44'/501'/0'/0', each hardened.

export interface SolanaKeypair {
  /** 32-byte ed25519 secret seed. */
  secretSeed: Uint8Array;
  /** 32-byte ed25519 public key. */
  publicKey: Uint8Array;
  /** base58-encoded address (= public key, 43-44 chars). */
  address: string;
}

/** Derive a Solana keypair from a BIP-39 mnemonic (no passphrase). */
export async function deriveSolanaFromMnemonic(mnemonic: string): Promise<SolanaKeypair> {
  if (!bip39.validateMnemonic(mnemonic.trim())) {
    throw new Error('Invalid BIP-39 mnemonic');
  }
  const seed = await bip39.mnemonicToSeed(mnemonic.trim());
  return deriveSolanaFromSeed(new Uint8Array(seed));
}

export function deriveSolanaFromSeed(seed: Uint8Array): SolanaKeypair {
  // Master key per SLIP-0010 ed25519.
  let { key, chainCode } = slip10MasterEd25519(seed);

  // Hardened-only descent along m/44'/501'/0'/0'.
  for (const segment of SOLANA_PATH) {
    ({ key, chainCode } = slip10ChildEd25519(key, chainCode, segment + HARDENED_OFFSET));
  }

  const secretSeed = key;
  const publicKey = ed25519.getPublicKey(secretSeed);
  return {
    secretSeed,
    publicKey,
    address: base58Encode(publicKey),
  };
}

function slip10MasterEd25519(seed: Uint8Array): { key: Uint8Array; chainCode: Uint8Array } {
  const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

function slip10ChildEd25519(
  parentKey: Uint8Array,
  parentChain: Uint8Array,
  index: number,
): { key: Uint8Array; chainCode: Uint8Array } {
  // Hardened derivation: data = 0x00 || parent_key || ser32be(index)
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parentKey, 1);
  data[33] = (index >>> 24) & 0xff;
  data[34] = (index >>> 16) & 0xff;
  data[35] = (index >>> 8) & 0xff;
  data[36] = index & 0xff;
  const I = hmac(sha512, parentChain, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}
