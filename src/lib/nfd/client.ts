// Singleton NfdClient per network. The SDK's factory methods build their
// own AlgorandClient pointed at the right algod endpoint, so we rely on
// those and avoid version drift with algokit-utils.

import { NfdClient } from '@txnlab/nfd-sdk';
import type { NetworkId } from '../../types/wallet';

const clients: Partial<Record<NetworkId, NfdClient>> = {};

export function getNfdClient(network: NetworkId): NfdClient {
  const existing = clients[network];
  if (existing) return existing;
  let client: NfdClient;
  switch (network) {
    case 'mainnet':
      client = NfdClient.mainNet();
      break;
    case 'testnet':
    case 'betanet':
      // NFD isn't deployed on betanet. Fall back to testnet — mint will
      // simply fail with "unknown network" if the user tries to use it.
      client = NfdClient.testNet();
      break;
  }
  clients[network] = client;
  return client;
}

/** Clear cached clients. Used when switching networks to drop stale signers. */
export function resetNfdClients(): void {
  for (const k of Object.keys(clients) as NetworkId[]) {
    delete clients[k];
  }
}
