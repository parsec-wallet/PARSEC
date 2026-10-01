// Solana vault-secret formats. The vault stores one string per Solana address:
//   * a BIP-39 mnemonic (the wallet's own derivation, m/44'/501'/0'/0'), or
//   * a tagged raw key `solana-raw:<base58 of the 64-byte secret>` for keys imported from Phantom /
//     Solflare / `solana-keygen` JSON — the participant keeps custody of a key they already own.
// Every signer (kit-signer.ts, transfer.ts, module.ts) resolves the secret through
// `keypairFromVaultSecret` so both forms sign identically.

import * as bip39 from 'bip39';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58Decode, base58Encode } from './address';
import { deriveSolanaFromMnemonic, type SolanaKeypair } from './seed';

export const RAW_TAG = 'solana-raw:';

export type ParsedSolanaSecret =
  | { kind: 'mnemonic'; mnemonic: string }
  | { kind: 'raw'; secret: Uint8Array };

function keypairFromRaw(secret: Uint8Array): SolanaKeypair {
  if (secret.length !== 64 && secret.length !== 32) throw new Error(`expected a 32- or 64-byte Solana secret, got ${secret.length}`);
  const secretSeed = secret.slice(0, 32);
  const publicKey = ed25519.getPublicKey(secretSeed);
  if (secret.length === 64) {
    const claimed = secret.slice(32);
    for (let i = 0; i < 32; i++) if (claimed[i] !== publicKey[i]) throw new Error('Solana secret key does not match its public key');
  }
  return { secretSeed, publicKey, address: base58Encode(publicKey) };
}

/**
 * Accepts what people actually paste: a 12/24-word mnemonic, a Phantom/Solflare base58 export
 * (64 bytes), a `solana-keygen` JSON array (64 numbers), or a bare 32-byte seed in base58.
 */
export function parseSolanaSecret(input: string): ParsedSolanaSecret {
  const s = input.trim();
  if (!s) throw new Error('empty secret');
  if (s.startsWith('[')) {
    const arr = JSON.parse(s) as unknown;
    if (!Array.isArray(arr) || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error('JSON keypair must be an array of bytes');
    return { kind: 'raw', secret: Uint8Array.from(arr as number[]) };
  }
  if (s.startsWith(RAW_TAG)) return { kind: 'raw', secret: base58Decode(s.slice(RAW_TAG.length)) };
  if (/\s/.test(s)) {
    const words = s.toLowerCase().split(/\s+/).join(' ');
    if (!bip39.validateMnemonic(words)) throw new Error('Invalid BIP-39 mnemonic');
    return { kind: 'mnemonic', mnemonic: words };
  }
  const bytes = base58Decode(s);
  if (bytes.length === 64 || bytes.length === 32) return { kind: 'raw', secret: bytes };
  throw new Error('Unrecognised Solana secret (expected mnemonic, base58 keypair, or JSON keypair)');
}

/** The string to put in the vault for a parsed secret. Mnemonics are stored verbatim. */
export function encodeVaultSecret(p: ParsedSolanaSecret): string {
  if (p.kind === 'mnemonic') return p.mnemonic;
  const kp = keypairFromRaw(p.secret);
  const full = new Uint8Array(64);
  full.set(kp.secretSeed, 0);
  full.set(kp.publicKey, 32);
  return RAW_TAG + base58Encode(full);
}

/** Resolve any vault secret string to a keypair. Caller zeroizes `secretSeed`. */
export async function keypairFromVaultSecret(secret: string): Promise<SolanaKeypair> {
  const p = parseSolanaSecret(secret);
  return p.kind === 'mnemonic' ? deriveSolanaFromMnemonic(p.mnemonic) : keypairFromRaw(p.secret);
}

/** Address a secret would import as, without storing anything. */
export async function previewSolanaSecret(input: string): Promise<{ address: string; kind: ParsedSolanaSecret['kind'] }> {
  const p = parseSolanaSecret(input);
  const kp = await keypairFromVaultSecret(encodeVaultSecret(p));
  kp.secretSeed.fill(0);
  return { address: kp.address, kind: p.kind };
}

/** 64-byte `[seed || pubkey]` JSON array — the `solana-keygen` / ar-io-node `*_KEYPAIR_PATH` format. */
export function toKeypairJson(kp: SolanaKeypair): string {
  const full = new Uint8Array(64);
  full.set(kp.secretSeed, 0);
  full.set(kp.publicKey, 32);
  return JSON.stringify(Array.from(full));
}
