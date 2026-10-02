// PARSEC Wallet — an Algorand transaction signer for the active account.
//
// Desktop: the PARSEC Keycore signs (`chain_algo_sign_transaction` through the
// x402 adapter's signer); no phrase enters JavaScript. If the vault is locked
// the person is asked to unlock again — the passphrase is not kept to reopen it.
// Browser build (no Keycore): the key is read from the browser keystore for
// the moment of signing; call `dispose()` afterwards to overwrite it.

import algosdk from 'algosdk';
import { store } from '../store';
import { isTauri } from '../platform';
import { keystoreRetrieve } from '../keystore';
import { parsecAvmSigner } from '../x402/adapters/parsec';

export interface WalletSigner {
  address: string;
  sign: algosdk.TransactionSigner;
  /** Forget any key material held for the browser build. */
  dispose(): void;
}

export async function walletSigner(address: string): Promise<WalletSigner> {
  if (isTauri) {
    const keycore = parsecAvmSigner(address);
    const sign: algosdk.TransactionSigner = async (group, indexes) => {
      try {
        return await keycore.sign(group, indexes);
      } catch (e) {
        throw lockedOr(e);
      }
    };
    return { address, sign, dispose: () => { /* nothing held */ } };
  }
  const pass = store.getPassphrase();
  if (!pass) throw new Error('Unlock the wallet first.');
  let mnemonic = await keystoreRetrieve(address, pass);
  if (!mnemonic) throw new Error('Could not read this account’s key.');
  let account: algosdk.Account | null = algosdk.mnemonicToSecretKey(mnemonic.trim());
  mnemonic = '\0'.repeat(mnemonic.length);
  mnemonic = null;
  return {
    address,
    sign: async (group, indexes) => {
      if (!account) throw new Error('This signer was disposed.');
      return indexes.map((i) => group[i].signTxn(account!.sk));
    },
    dispose: () => { if (account) { account.sk.fill(0); account = null; } },
  };
}

/** A "vault is locked" error from the Keycore, said so the person knows what to do. */
export function lockedOr(e: unknown): unknown {
  return /locked/i.test(String(e)) ? new Error('The vault is locked. Unlock PARSEC again.') : e;
}
