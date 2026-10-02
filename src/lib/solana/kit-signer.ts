// Solana signers for vault accounts.
//
// Desktop: the PARSEC Keycore signs (`chain_sol_sign`); the key never enters JavaScript.
// Browser build (no Keycore): the vault secret is read for the moment of signing — mnemonic
// or tagged raw key, through `keypairFromVaultSecret` — and the seed is zeroed after.
//
// `createVaultTransactionSigner` gives the @solana/kit `TransactionPartialSigner` the
// @ar.io/sdk expects. Loaded lazily (the sdk + kit are dynamic imports) so the base wallet
// bundle is unchanged.

import type { Address, SignatureBytes, SignatureDictionary, TransactionPartialSigner } from '@solana/kit';
import { ed25519 } from '@noble/curves/ed25519.js';
import { isTauri } from '../platform';
import { keystoreRetrieve } from '../keystore';
import { solSign } from '../chain-sol';
import { keypairFromVaultSecret } from './secret';

/** Signs a compiled Solana message (no prefix) as `address`. */
export interface SolanaMessageSigner {
  address: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export function solanaMessageSigner(address: string, passphrase = ''): SolanaMessageSigner {
  if (isTauri) {
    return {
      address,
      async sign(message) {
        const { signature_b64 } = await solSign(address, bytesToB64(message));
        return b64ToBytes(signature_b64);
      },
    };
  }
  return {
    address,
    async sign(message) {
      const secret = await keystoreRetrieve(address, passphrase);
      if (!secret) throw new Error(`No Solana key in vault for ${address}`);
      const kp = await keypairFromVaultSecret(secret);
      try {
        if (kp.address !== address) throw new Error(`Vault key mismatch: expected ${address}, got ${kp.address}`);
        return ed25519.sign(message, kp.secretSeed);
      } finally {
        kp.secretSeed.fill(0);
      }
    },
  };
}

/**
 * A @solana/kit `TransactionPartialSigner` for the vault-held Solana account.
 * `address` is the base58 Solana address (== walletId in the solana module).
 */
export async function createVaultTransactionSigner(
  address: string,
  passphrase: string,
): Promise<TransactionPartialSigner> {
  if (isTauri) {
    const inner = solanaMessageSigner(address);
    return {
      address: address as Address,
      async signTransactions(transactions) {
        const out: SignatureDictionary[] = [];
        for (const tx of transactions) {
          const sig = (await inner.sign(Uint8Array.from(tx.messageBytes as unknown as Uint8Array))) as SignatureBytes;
          out.push({ [address]: sig } as SignatureDictionary);
        }
        return out;
      },
    };
  }
  const secret = await keystoreRetrieve(address, passphrase);
  if (!secret) throw new Error(`No Solana key in vault for ${address}`);
  const kp = await keypairFromVaultSecret(secret);
  if (kp.address !== address) {
    kp.secretSeed.fill(0);
    throw new Error(`Vault key mismatch: expected ${address}, got ${kp.address}`);
  }
  const { createKeyPairSignerFromBytes } = await import('@solana/kit');
  const full = new Uint8Array(64);
  full.set(kp.secretSeed, 0);
  full.set(kp.publicKey, 32);
  try {
    return await createKeyPairSignerFromBytes(full);
  } finally {
    full.fill(0);
    kp.secretSeed.fill(0);
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
