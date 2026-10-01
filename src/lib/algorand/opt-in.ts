// PARSEC Wallet — opt in to an Algorand asset: the one function every screen uses.
//
// Desktop: the transaction is signed by the PARSEC Keycore (no phrase enters
// JavaScript); if the vault session has timed out, it is reopened once with
// the session passphrase. Browser build (no Keycore): the key is read from the
// browser keystore for the moment of signing and overwritten after.

import { store } from '../store';
import { isTauri } from '../platform';
import { keystoreRetrieve, keystoreUnlock } from '../keystore';
import { optInWithKeycore, optInToAsset } from './assets';
import type { NetworkId } from '../../types/wallet';

export async function optInAsset(address: string, assetId: number, network: NetworkId): Promise<{ txId: string }> {
  if (isTauri) {
    try {
      return await optInWithKeycore(address, assetId, network);
    } catch (e) {
      const pass = store.getPassphrase();
      if (!pass || !/locked/i.test(String(e)) || !(await keystoreUnlock(pass))) throw e;
      return await optInWithKeycore(address, assetId, network);
    }
  }
  const pass = store.getPassphrase();
  if (!pass) throw new Error('Unlock the wallet first.');
  let mnemonic = await keystoreRetrieve(address, pass);
  if (!mnemonic) throw new Error('Could not read this account’s key.');
  try {
    return await optInToAsset(mnemonic, assetId, network);
  } finally {
    mnemonic = '\0'.repeat(mnemonic.length);
    mnemonic = null;
  }
}
