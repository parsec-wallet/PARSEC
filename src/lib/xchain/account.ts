// EVM-address ↔ Algorand-LogicSig-address derivation.
// The mapping is deterministic and on-chain-verifiable; no key material
// ever lives in parsec — MetaMask remains the sole custodian.

import type { NetworkId } from '../../types/wallet';
import { getXchainSdk } from './sdk';

/** Derive the Algorand LogicSig address controlled by a given EVM address. */
export async function deriveAlgorandFromEvm(
  evmAddress: string,
  network: NetworkId,
): Promise<string> {
  const sdk = getXchainSdk(network);
  return await sdk.getAddress({ evmAddress });
}

/**
 * Reverse-lookup: scan recent sender-side txs for a LogicSig matching the
 * xChain template and recover the controlling EVM address. Returns null if
 * the address has never sent a transaction or no match is found in the window.
 */
export async function lookupEvmFromAlgorand(
  algorandAddress: string,
  network: NetworkId,
  limit = 1,
): Promise<string | null> {
  const sdk = getXchainSdk(network);
  return await sdk.getEvmAddressFromAccount({ algorandAddress, limit });
}
