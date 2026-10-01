// Parsec Wallet — Wallet Recovery
//
// Opening an existing wallet with nothing but the passphrase.
//
// `store.accounts` is persisted to localStorage under 'parsec-wallet-state',
// but the KEYS live somewhere else entirely: the bankon_vault file on desktop,
// or 'parsec-encrypted-keys' in the browser. Those two can part company —
// a cleared site-data, a restored machine, a fresh install pointed at an
// existing vault — and when they do, the wallet looks empty even though every
// key is still there and the passphrase still works.
//
// This module reads the keystore as the authority and rebuilds the account
// list from it. The frontend only SUGGESTS which chain an address belongs to;
// on desktop the vault already knows, and Rust remains the validator.

import { isTauri, vaultListAccounts } from './vault';
import * as webCrypto from './crypto';
import type { ChainId } from './pouch/types';
import type { WalletAccount } from '../types/wallet';

export interface RecoveredKey {
  readonly address: string;
  /** Chain the keystore recorded, or the shape-inferred guess in web mode. */
  readonly chain: ChainId;
  readonly label: string;
  /** False when the chain was inferred from the address shape rather than
   *  read from the keystore — the caller may want to say so. */
  readonly chainKnown: boolean;
}

// ── Address shape inference (web mode only) ───────────────────
// The browser keystore stores {address, cipher} with no chain tag, so the
// chain has to be inferred. These are deliberately conservative: an address
// we cannot place stays 'unknown' rather than being forced into a chain.

const EVM = /^0x[0-9a-fA-F]{40}$/;
const ALGORAND = /^[A-Z2-7]{58}$/;
const BTC_BECH32 = /^(bc1|tb1)[0-9a-z]{20,80}$/;
const BTC_LEGACY = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Guess which chain an address belongs to from its shape.
 *
 * Arweave and Solana genuinely overlap: an Arweave address is 43 base64url
 * characters, and a Solana address is 32–44 base58 characters. Base58 excludes
 * `-` and `_`, so an address carrying either is Arweave; a 43-character string
 * using only base58 characters is ambiguous and resolves to Solana, which is
 * the far more common case. Desktop never relies on this — the vault records
 * the chain.
 */
export function inferChainFromAddress(address: string): ChainId | 'unknown' {
  const a = address.trim();
  if (EVM.test(a)) return 'ethereum';
  if (BTC_BECH32.test(a) || BTC_LEGACY.test(a)) return 'bitcoin';
  if (ALGORAND.test(a)) return 'algorand';
  if (BASE64URL_43.test(a) && /[-_]/.test(a)) return 'arweave';
  if (BASE58.test(a)) return 'solana';
  if (BASE64URL_43.test(a)) return 'arweave';
  return 'unknown';
}

/**
 * Every key the keystore holds, from whichever backend is in play.
 * Returns an empty list when there is nothing to recover.
 */
export async function recoverKeys(): Promise<RecoveredKey[]> {
  if (isTauri()) {
    try {
      const entries = await vaultListAccounts();
      return entries.map((e) => ({
        address: e.address,
        chain: (e.chain || 'algorand') as ChainId,
        label: e.label || 'Account',
        chainKnown: Boolean(e.chain),
      }));
    } catch {
      return [];
    }
  }

  // Web: the encrypted-keys blob lists addresses but records no chain.
  try {
    return webCrypto.listAccounts().map((a) => {
      const inferred = inferChainFromAddress(a.address);
      return {
        address: a.address,
        chain: (inferred === 'unknown' ? 'algorand' : inferred) as ChainId,
        label: 'Recovered account',
        chainKnown: false,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Fold recovered keys into the existing account list.
 *
 * Algorand keys become accounts — that is the identity Parsec is built on.
 * Every other key attaches as a per-chain address on the account it belongs
 * to, matched by address where possible and otherwise onto the first account.
 * Accounts already known are left completely alone.
 *
 * Pure and synchronous so it can be tested without a keystore.
 */
export function mergeRecovered(
  existing: readonly WalletAccount[],
  recovered: readonly RecoveredKey[],
): { accounts: WalletAccount[]; added: number; attached: number } {
  const accounts: WalletAccount[] = existing.map((a) => ({ ...a, chains: { ...a.chains } }));
  const known = new Set(accounts.map((a) => a.address));
  let added = 0;
  let attached = 0;

  // Pass 1 — new identities.
  for (const key of recovered) {
    if (key.chain !== 'algorand' || known.has(key.address)) continue;
    accounts.push({
      address: key.address,
      name: key.label || `Account ${accounts.length + 1}`,
      createdAt: Date.now(),
      chains: { algorand: key.address },
    });
    known.add(key.address);
    added++;
  }

  // Pass 2 — per-chain addresses hang off an identity.
  for (const key of recovered) {
    if (key.chain === 'algorand') continue;
    const owner =
      accounts.find((a) => a.chains?.[key.chain] === key.address) ?? accounts[0];
    if (!owner) continue;                       // nothing to attach to
    if (owner.chains?.[key.chain] === key.address) continue;  // already recorded
    owner.chains = { ...owner.chains, [key.chain]: key.address };
    attached++;
  }

  return { accounts, added, attached };
}
