// PARSEC Wallet — Algorand Client Configuration
import algosdk from 'algosdk';
import type { NetworkId } from '../../types/wallet';

interface NetworkConfig {
  algodUrl: string;
  algodToken: string;
  indexerUrl: string;
  indexerToken: string;
}

const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    algodUrl: 'https://mainnet-api.algonode.cloud',
    algodToken: '',
    indexerUrl: 'https://mainnet-idx.algonode.cloud',
    indexerToken: '',
  },
  testnet: {
    algodUrl: 'https://testnet-api.algonode.cloud',
    algodToken: '',
    indexerUrl: 'https://testnet-idx.algonode.cloud',
    indexerToken: '',
  },
  betanet: {
    algodUrl: 'https://betanet-api.algonode.cloud',
    algodToken: '',
    indexerUrl: 'https://betanet-idx.algonode.cloud',
    indexerToken: '',
  },
};

export function getAlgodClient(network: NetworkId): algosdk.Algodv2 {
  const config = NETWORKS[network];
  return new algosdk.Algodv2(config.algodToken, config.algodUrl, '');
}

export function getIndexerClient(network: NetworkId): algosdk.Indexer {
  const config = NETWORKS[network];
  return new algosdk.Indexer(config.indexerToken, config.indexerUrl, '');
}
