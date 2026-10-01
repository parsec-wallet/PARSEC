// Bridge PARSEC's keystore to the SDK's TransactionSigner contract.
//
// The SDK expects a function that signs an arbitrary group with a set of
// `indexesToSign`. PARSEC holds the mnemonic inside the session passphrase-
// derived keystore; this adapter retrieves it, uses algosdk to sign, then
// wipes the mnemonic from local memory immediately.

import algosdk, { type TransactionSigner } from 'algosdk';
import { keystoreRetrieve } from '../keystore';

/**
 * Build a TransactionSigner that signs exclusively with the account at the
 * given address. The passphrase is read once and held only for the duration
 * of signing — caller should ensure the session is unlocked.
 *
 * JS strings are immutable; we can't truly zero the mnemonic, but we drop
 * every reference to it as soon as signing completes so GC can reclaim it.
 */
export function makeParsecSigner(address: string, passphrase: string): TransactionSigner {
  return async (txnGroup, indexesToSign) => {
    const mnemonic = await keystoreRetrieve(address, passphrase);
    if (!mnemonic) throw new Error('parsec: mnemonic not in keystore');
    let account: algosdk.Account | null = null;
    try {
      account = algosdk.mnemonicToSecretKey(mnemonic);
      if (account.addr.toString() !== address) {
        throw new Error('parsec: signer address mismatch');
      }
      return indexesToSign.map((i) => txnGroup[i].signTxn(account!.sk));
    } finally {
      if (account?.sk) account.sk.fill(0);
    }
  };
}
