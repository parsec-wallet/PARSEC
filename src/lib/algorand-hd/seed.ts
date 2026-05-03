// BIP-39 mnemonic + seed handling for ARC-52 (BIP32-Ed25519) accounts.
// Distinct from algosdk's 25-word mnemonic flow — these are 24-word BIP-39
// phrases that derive a hierarchical extended root key.

import * as bip39 from 'bip39';
import { fromSeed } from '@algorandfoundation/xhd-wallet-api';

/** Generate a fresh 24-word BIP-39 mnemonic. */
export function generateBip39Mnemonic(): string {
  return bip39.generateMnemonic(256); // 256 bits → 24 words
}

/** Validate a BIP-39 mnemonic (wordlist + checksum). */
export function validateBip39Mnemonic(phrase: string): boolean {
  return bip39.validateMnemonic(phrase.trim());
}

/**
 * Derive the 96-byte extended root key from a BIP-39 mnemonic.
 * The returned Uint8Array is sensitive — caller MUST `.fill(0)` after use.
 */
export function rootKeyFromMnemonic(phrase: string, passphrase = ''): Uint8Array {
  if (!validateBip39Mnemonic(phrase)) throw new Error('Invalid BIP-39 mnemonic');
  const seed = bip39.mnemonicToSeedSync(phrase.trim(), passphrase);
  try {
    return fromSeed(seed);
  } finally {
    seed.fill(0);
  }
}
