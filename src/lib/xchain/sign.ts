// Sign Algorand transaction groups with an EVM (MetaMask-style) wallet.
// The EVM wallet signs an EIP-712 typed message; on-chain ecdsa_pk_recover
// inside the LogicSig program verifies the signature.

import type algosdk from 'algosdk';
import type { NetworkId } from '../../types/wallet';
import type { EIP1193Provider } from '../builder/types';
import { getXchainSdk } from './sdk';

/**
 * Sign one or more algosdk Transactions with the EVM lsig.
 * The provider must be an injected EIP-1193 wallet (MetaMask, Rabby, ...).
 * Returns the signed-transaction blobs ready for `algodClient.sendRawTransaction`.
 */
export async function signTxnWithMetamask(
  provider: EIP1193Provider,
  evmAddress: string,
  txns: algosdk.Transaction[],
  network: NetworkId,
): Promise<Uint8Array[]> {
  const sdk = getXchainSdk(network);

  // Make sure MetaMask actually has this account available.
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts.some((a) => a.toLowerCase() === evmAddress.toLowerCase())) {
    throw new Error(`EVM address ${evmAddress} not available in injected provider`);
  }

  return await sdk.signTxn({
    evmAddress,
    txns,
    signMessage: async ({ domain, types, primaryType, message }) => {
      const typedData = JSON.stringify({ domain, types, primaryType, message });
      const sig = (await provider.request({
        method: 'eth_signTypedData_v4',
        params: [evmAddress, typedData],
      })) as string;
      return sig;
    },
  });
}
