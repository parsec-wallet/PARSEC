// Bridge the NFD SDK's TransactionSigner contract to PARSEC's wallet signer.
//
// The SDK signs an arbitrary group at `indexesToSign`. On desktop and phone the PARSEC
// Keycore signs (`walletSigner` → `chain_algo_sign_transaction`): each transaction goes to
// Rust and only the signature comes back — no recovery phrase enters JavaScript, and the
// Keycore checks the stored key belongs to the address. The browser build (no Keycore) uses
// its documented in-tab signer.

import type { TransactionSigner } from 'algosdk';
import { walletSigner } from '../algorand/signer';

/**
 * A TransactionSigner that signs only as `address`. `passphrase` is kept in the signature for
 * the callers' sake; the Keycore needs only the unlocked session.
 */
export function makeParsecSigner(address: string, _passphrase?: string): TransactionSigner {
  return async (txnGroup, indexesToSign) => {
    for (const i of indexesToSign) {
      if (txnGroup[i].sender.toString() !== address) throw new Error('parsec: signer address mismatch');
    }
    const signer = await walletSigner(address);
    try {
      return await signer.sign(txnGroup, indexesToSign);
    } finally {
      signer.dispose();
    }
  };
}
