// NFD endpoints — one map, imported everywhere the wrapper or a view talks
// to the NFD HTTP API directly (the SDK carries its own copy internally).
//
// Mainnet and testnet have separate registries; betanet has no NFD
// deployment so it shares the testnet endpoint (calls will simply fail
// with "unknown network" if a user tries to mint there).

import type { NetworkId } from '../../types/wallet';

export const NFD_API_BASE: Record<NetworkId, string> = {
  mainnet: 'https://api.nf.domains',
  testnet: 'https://api.testnet.nf.domains',
  betanet: 'https://api.testnet.nf.domains',
};

/** Hosted NFD registry UI — profile pages live at `${NFD_SITE}/name/<name>`. */
export const NFD_SITE = 'https://app.nf.domains';

/** API base for a network, falling back to mainnet for an unknown value. */
export function nfdApiBase(network: NetworkId): string {
  return NFD_API_BASE[network] ?? NFD_API_BASE.mainnet;
}
