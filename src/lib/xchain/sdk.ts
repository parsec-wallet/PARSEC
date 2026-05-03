// Memoized AlgoXEvmSdk per network. Reuses parsec's existing algod/indexer
// clients via algokit-utils' AlgorandClient.fromClients().

import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { AlgoXEvmSdk } from 'algo-x-evm-sdk';
import type { NetworkId } from '../../types/wallet';
import { getAlgodClient, getIndexerClient } from '../algorand/client';

const cache = new Map<NetworkId, AlgoXEvmSdk>();

export function getXchainSdk(network: NetworkId): AlgoXEvmSdk {
  let sdk = cache.get(network);
  if (sdk) return sdk;

  const algorand = AlgorandClient.fromClients({
    algod: getAlgodClient(network),
    indexer: getIndexerClient(network),
  });
  sdk = new AlgoXEvmSdk({ algorand });
  cache.set(network, sdk);
  return sdk;
}
