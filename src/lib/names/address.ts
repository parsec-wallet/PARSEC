// Which of the account's addresses a namespace signs with. Kept apart from controller-model.ts so
// the model stays store-free and testable.

import { getAccountAddress } from '../store';
import type { WalletAccount } from '../../types/wallet';
import type { NamespaceAdapter } from '../namespaces/types';
import type { AddressChain } from './controller-model';

export function addressChainFor(ns: NamespaceAdapter | undefined): AddressChain {
  return ns?.addressChain ?? 'arweave-hd';
}

/** The address the adapter expects as owner/controller/signer for this account, or undefined. */
export function namespaceAddress(account: WalletAccount, ns: NamespaceAdapter | undefined): string | undefined {
  if (addressChainFor(ns) === 'solana') return getAccountAddress(account, 'solana');
  return getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave');
}
