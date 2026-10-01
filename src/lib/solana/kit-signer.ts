// Vault → @solana/kit signer bridge. Wraps the existing keystoreRetrieve → SLIP-0010 derive →
// zeroize flow (module.ts) into the TransactionSigner interface the @ar.io/sdk expects, so ArNS
// writes sign with the parsec-held key without the key ever leaving this module's scope.
//
// Loaded lazily (the sdk + kit are dynamic imports) so the base wallet bundle is unchanged.

import { keystoreRetrieve } from '../keystore';
import { deriveSolanaFromMnemonic } from './seed';

/**
 * Build a @solana/kit KeyPairSigner for the vault-held Solana wallet.
 * `address` is the base58 Solana address (== walletId in the solana module).
 * The 64-byte secret is zeroized after the kit imports it into WebCrypto.
 */
export async function createVaultTransactionSigner(address: string, passphrase: string) {
  const mnemonic = await keystoreRetrieve(address, passphrase);
  if (!mnemonic) throw new Error(`No Solana key in vault for ${address}`);
  const kp = await deriveSolanaFromMnemonic(mnemonic);
  if (kp.address !== address) throw new Error(`Vault key mismatch: expected ${address}, got ${kp.address}`);
  const { createKeyPairSignerFromBytes } = await import('@solana/kit');
  const secret = new Uint8Array(64);
  secret.set(kp.secretSeed, 0);
  secret.set(kp.publicKey, 32);
  try {
    return await createKeyPairSignerFromBytes(secret);
  } finally {
    secret.fill(0);
    kp.secretSeed.fill(0);
  }
}
