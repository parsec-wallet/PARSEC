// Observer key for the gateway node. ar-io-node needs the OBSERVER key on the host (it signs
// observation reports) and the operator key must NOT be there — so parsec mints a separate key,
// keeps it in the vault under a dedicated chain id, and exports the keypair JSON only behind an
// explicit, typed confirmation in the UI. That export is the single place a private key leaves the vault.

import * as bip39 from 'bip39';
import { keystoreStore, keystoreRetrieve } from '../../keystore';
import { getAccountAddress, setAccountAddress } from '../../store';
import type { WalletAccount } from '../../../types/wallet';
import { deriveSolanaFromMnemonic } from '../../solana/seed';
import { keypairFromVaultSecret, toKeypairJson } from '../../solana/secret';
import { readArio } from '../client';

export const OBSERVER_CHAIN_ID = 'solana-observer';
export const UPLOAD_CHAIN_ID = 'solana-upload';

export function observerAddressOf(account: WalletAccount): string | undefined {
  return getAccountAddress(account, OBSERVER_CHAIN_ID);
}

/** Mint a fresh 24-word key for `role` and map it onto the account. */
export async function createNodeKey(
  passphrase: string,
  account: WalletAccount,
  role: 'observer' | 'upload' = 'observer',
): Promise<{ account: WalletAccount; address: string }> {
  const mnemonic = bip39.generateMnemonic(256);
  const kp = await deriveSolanaFromMnemonic(mnemonic);
  kp.secretSeed.fill(0);
  const chainId = role === 'observer' ? OBSERVER_CHAIN_ID : UPLOAD_CHAIN_ID;
  await keystoreStore(kp.address, mnemonic, passphrase, role === 'observer' ? 'AR.IO observer' : 'AR.IO upload', 'solana');
  return { account: setAccountAddress(account, chainId, kp.address), address: kp.address };
}

/** Keypair JSON (64-byte array) for `OBSERVER_KEYPAIR_PATH` / `SOLANA_UPLOAD_KEYPAIR_PATH`. */
export async function exportNodeKeypairJson(address: string, passphrase: string): Promise<string> {
  const secret = await keystoreRetrieve(address, passphrase);
  if (!secret) throw new Error(`No key in vault for ${address}`);
  const kp = await keypairFromVaultSecret(secret);
  if (kp.address !== address) throw new Error('vault key mismatch');
  try {
    return toKeypairJson(kp);
  } finally {
    kp.secretSeed.fill(0);
  }
}

/** True when no registered gateway already uses `observer` (ObserverLookup PDA is unique on-chain). */
export async function isObserverUnique(observer: string, opts: { pageSize?: number; maxPages?: number } = {}): Promise<{ unique: boolean; scanned: number }> {
  const ario = (await readArio()) as { getGateways: (p: { limit: number; cursor?: string }) => Promise<{ items: { observerAddress?: string }[]; nextCursor?: string; hasMore?: boolean }> };
  let cursor: string | undefined;
  let scanned = 0;
  for (let page = 0; page < (opts.maxPages ?? 40); page++) {
    const res = await ario.getGateways({ limit: opts.pageSize ?? 100, ...(cursor ? { cursor } : {}) });
    for (const g of res.items ?? []) {
      scanned++;
      if (g.observerAddress === observer) return { unique: false, scanned };
    }
    if (!res.nextCursor || res.hasMore === false) break;
    cursor = res.nextCursor;
  }
  return { unique: true, scanned };
}
