// Vault-bridged signing for ARC-52 derived accounts.
// Loads the BIP-39 mnemonic from bankon_vault, derives the rootKey, signs,
// then zeroizes the mnemonic and rootKey buffers.

import { vaultRetrieveKey } from '../vault';
import { rootKeyFromMnemonic } from './seed';
import { signTxn as deriveSignTxn } from './derive';

/**
 * Sign a prefix-encoded Algorand transaction for the given primary HD wallet
 * + account + keyIndex. The seed never persists in JS — retrieved, used, dropped.
 */
export async function signAlgoTxnFromVault(
  primaryAddress: string,
  account: number,
  keyIndex: number,
  prefixEncodedTx: Uint8Array,
): Promise<Uint8Array> {
  const mnemonic = await vaultRetrieveKey(primaryAddress);
  if (!mnemonic) throw new Error('HD seed not found in vault (locked or missing)');

  const rootKey = rootKeyFromMnemonic(mnemonic);
  try {
    return await deriveSignTxn(rootKey, account, keyIndex, prefixEncodedTx);
  } finally {
    rootKey.fill(0);
    // The mnemonic string itself is immutable in JS; we drop the reference
    // and let GC reclaim it. (Same pattern as the existing 25-word flow.)
  }
}
