// PARSEC — Chain Registry
// Dynamic chain discovery. 2500+ EVM chains from allchain API.
// Static entries for non-EVM families (UTXO, CryptoNote, Algorand).
// (c) 2026 BANKON — GPL-3.0

import type { ChainDescriptor, ChainFamily, NetworkType } from './types';

// ── Static Chain Definitions ─────────────────────────────────
// Non-EVM chains and core EVM chains hardcoded for offline use.

const STATIC_CHAINS: ChainDescriptor[] = [
  // ── Algorand ──
  {
    chainId: 'algorand',
    family: 'algorand',
    name: 'Algorand',
    networkType: 'mainnet',
    ticker: 'ALGO',
    decimals: 6,
    rpcUrl: 'https://mainnet-api.algonode.cloud',
    explorerUrl: 'https://explorer.perawallet.app',
    enabled: true,
  },
  {
    chainId: 'algorand-testnet',
    family: 'algorand',
    name: 'Algorand Testnet',
    networkType: 'testnet',
    ticker: 'ALGO',
    decimals: 6,
    rpcUrl: 'https://testnet-api.algonode.cloud',
    explorerUrl: 'https://testnet.explorer.perawallet.app',
    enabled: true,
  },

  // ── Bitcoin ──
  {
    chainId: 'bitcoin',
    family: 'utxo',
    name: 'Bitcoin',
    networkType: 'mainnet',
    ticker: 'BTC',
    decimals: 8,
    explorerUrl: 'https://mempool.space',
    enabled: true,
  },
  {
    chainId: 'bitcoin-testnet',
    family: 'utxo',
    name: 'Bitcoin Testnet',
    networkType: 'testnet',
    ticker: 'tBTC',
    decimals: 8,
    explorerUrl: 'https://mempool.space/testnet',
    enabled: true,
  },

  // ── Litecoin ──
  {
    chainId: 'litecoin',
    family: 'utxo',
    name: 'Litecoin',
    networkType: 'mainnet',
    ticker: 'LTC',
    decimals: 8,
    explorerUrl: 'https://litecoinspace.org',
    enabled: true,
  },

  // ── Monero ──
  {
    chainId: 'monero',
    family: 'cryptonote',
    name: 'Monero',
    networkType: 'mainnet',
    ticker: 'XMR',
    decimals: 12,
    explorerUrl: 'https://xmrchain.net',
    enabled: true,
  },
  {
    chainId: 'monero-stagenet',
    family: 'cryptonote',
    name: 'Monero Stagenet',
    networkType: 'testnet',
    ticker: 'XMR',
    decimals: 12,
    enabled: true,
  },

  // ── Zilliqa ──
  {
    chainId: 'zilliqa',
    family: 'zilliqa',
    name: 'Zilliqa',
    networkType: 'mainnet',
    ticker: 'ZIL',
    decimals: 12,
    rpcUrl: 'https://api.zilliqa.com',
    explorerUrl: 'https://viewblock.io/zilliqa',
    enabled: true,
  },
  {
    chainId: 'zilliqa-testnet',
    family: 'zilliqa',
    name: 'Zilliqa Testnet',
    networkType: 'testnet',
    ticker: 'ZIL',
    decimals: 12,
    rpcUrl: 'https://dev-api.zilliqa.com',
    explorerUrl: 'https://viewblock.io/zilliqa?network=testnet',
    enabled: true,
  },
  // Zilliqa 2.0 EVM compatibility layer — uses EVM family for EVM-mode txns
  {
    chainId: 'zilliqa-evm',
    family: 'evm',
    name: 'Zilliqa EVM',
    networkId: 32769,
    networkType: 'mainnet',
    ticker: 'ZIL',
    decimals: 18,
    rpcUrl: 'https://api.zilliqa.com',
    explorerUrl: 'https://evmx.zilliqa.com',
    enabled: true,
  },

  // ── Cardano ──
  {
    chainId: 'cardano',
    family: 'cardano',
    name: 'Cardano',
    networkType: 'mainnet',
    ticker: 'ADA',
    decimals: 6,
    explorerUrl: 'https://cardanoscan.io',
    enabled: true,
  },
  {
    chainId: 'cardano-preprod',
    family: 'cardano',
    name: 'Cardano Preprod',
    networkType: 'testnet',
    ticker: 'tADA',
    decimals: 6,
    explorerUrl: 'https://preprod.cardanoscan.io',
    enabled: true,
  },
  {
    chainId: 'cardano-preview',
    family: 'cardano',
    name: 'Cardano Preview',
    networkType: 'testnet',
    ticker: 'tADA',
    decimals: 6,
    explorerUrl: 'https://preview.cardanoscan.io',
    enabled: true,
  },

  // ── Arweave ──
  {
    chainId: 'arweave',
    family: 'arweave',
    name: 'Arweave',
    networkType: 'mainnet',
    ticker: 'AR',
    decimals: 12,
    rpcUrl: 'https://arweave.net',
    explorerUrl: 'https://viewblock.io/arweave',
    enabled: true,
  },

  // ── Core EVM (offline fallback) ──
  {
    chainId: 'ethereum',
    family: 'evm',
    name: 'Ethereum',
    networkId: 1,
    networkType: 'mainnet',
    ticker: 'ETH',
    decimals: 18,
    explorerUrl: 'https://etherscan.io',
    enabled: true,
  },
  {
    chainId: 'polygon',
    family: 'evm',
    name: 'Polygon',
    networkId: 137,
    networkType: 'sidechain',
    ticker: 'POL',
    decimals: 18,
    explorerUrl: 'https://polygonscan.com',
    enabled: true,
  },
  {
    chainId: 'arbitrum',
    family: 'evm',
    name: 'Arbitrum One',
    networkId: 42161,
    networkType: 'l2',
    ticker: 'ETH',
    decimals: 18,
    explorerUrl: 'https://arbiscan.io',
    enabled: true,
  },
  {
    chainId: 'optimism',
    family: 'evm',
    name: 'OP Mainnet',
    networkId: 10,
    networkType: 'l2',
    ticker: 'ETH',
    decimals: 18,
    explorerUrl: 'https://optimistic.etherscan.io',
    enabled: true,
  },
  {
    chainId: 'base',
    family: 'evm',
    name: 'Base',
    networkId: 8453,
    networkType: 'l2',
    ticker: 'ETH',
    decimals: 18,
    explorerUrl: 'https://basescan.org',
    enabled: true,
  },
  {
    chainId: 'bsc',
    family: 'evm',
    name: 'BNB Smart Chain',
    networkId: 56,
    networkType: 'mainnet',
    ticker: 'BNB',
    decimals: 18,
    explorerUrl: 'https://bscscan.com',
    enabled: true,
  },
  {
    chainId: 'avalanche',
    family: 'evm',
    name: 'Avalanche C-Chain',
    networkId: 43114,
    networkType: 'mainnet',
    ticker: 'AVAX',
    decimals: 18,
    explorerUrl: 'https://snowtrace.io',
    enabled: true,
  },
  {
    chainId: 'zksync',
    family: 'evm',
    name: 'zkSync Era',
    networkId: 324,
    networkType: 'l2',
    ticker: 'ETH',
    decimals: 18,
    explorerUrl: 'https://explorer.zksync.io',
    enabled: true,
  },
  {
    chainId: 'fantom',
    family: 'evm',
    name: 'Fantom',
    networkId: 250,
    networkType: 'mainnet',
    ticker: 'FTM',
    decimals: 18,
    explorerUrl: 'https://ftmscan.com',
    enabled: true,
  },
  {
    chainId: 'gnosis',
    family: 'evm',
    name: 'Gnosis',
    networkId: 100,
    networkType: 'sidechain',
    ticker: 'xDAI',
    decimals: 18,
    explorerUrl: 'https://gnosisscan.io',
    enabled: true,
  },
  {
    chainId: 'celo',
    family: 'evm',
    name: 'Celo',
    networkId: 42220,
    networkType: 'mainnet',
    ticker: 'CELO',
    decimals: 18,
    explorerUrl: 'https://celoscan.io',
    enabled: true,
  },
  {
    chainId: 'scroll',
    family: 'evm',
    name: 'Scroll',
    networkId: 534352,
    networkType: 'l2',
    ticker: 'ETH',
    decimals: 18,
    explorerUrl: 'https://scrollscan.com',
    enabled: true,
  },
  {
    chainId: 'linea',
    family: 'evm',
    name: 'Linea',
    networkId: 59144,
    networkType: 'l2',
    ticker: 'ETH',
    decimals: 18,
    explorerUrl: 'https://lineascan.build',
    enabled: true,
  },
  {
    chainId: 'mantle',
    family: 'evm',
    name: 'Mantle',
    networkId: 5000,
    networkType: 'l2',
    ticker: 'MNT',
    decimals: 18,
    explorerUrl: 'https://mantlescan.xyz',
    enabled: true,
  },
  {
    chainId: 'blast',
    family: 'evm',
    name: 'Blast',
    networkId: 81457,
    networkType: 'l2',
    ticker: 'ETH',
    decimals: 18,
    explorerUrl: 'https://blastscan.io',
    enabled: true,
  },
];

// ── Allchain API Integration ─────────────────────────────────
// Dynamic discovery of 2500+ EVM chains from agenticplace allchain.

const ALLCHAIN_API = 'https://agenticplace.pythai.net';
const CHAINID_CDN = 'https://chainid.network/chains.json';

interface AllchainEntry {
  chainId: number;
  name: string;
  nativeCurrency?: { symbol: string; decimals: number };
  rpc?: string[];
  explorers?: { url: string }[];
  shortName?: string;
}

function classifyNetwork(name: string, chainId: number): NetworkType {
  const lower = name.toLowerCase();
  if (lower.includes('testnet') || lower.includes('sepolia') || lower.includes('goerli')) return 'testnet';
  if (lower.includes('l3') || lower.includes('orbit')) return 'l3';
  // Known L2 chain IDs
  const l2Ids = [10, 42161, 8453, 324, 534352, 59144, 5000, 81457, 34443, 7777777];
  if (l2Ids.includes(chainId) || lower.includes('l2') || lower.includes('rollup')) return 'l2';
  if (lower.includes('sidechain')) return 'sidechain';
  return 'mainnet';
}

// ── Registry ─────────────────────────────────────────────────

const dynamicChains: Map<string, ChainDescriptor> = new Map();
let allchainLoaded = false;

function staticMap(): Map<string, ChainDescriptor> {
  const m = new Map<string, ChainDescriptor>();
  for (const c of STATIC_CHAINS) m.set(c.chainId, c);
  return m;
}

const registry = staticMap();

/** Get a chain by its PARSEC chainId */
export function getChain(chainId: string): ChainDescriptor | undefined {
  return registry.get(chainId) ?? dynamicChains.get(chainId);
}

/** Get a chain by its EVM numeric chain ID */
export function getChainByNetworkId(networkId: number): ChainDescriptor | undefined {
  for (const c of registry.values()) {
    if (c.family === 'evm' && c.networkId === networkId) return c;
  }
  for (const c of dynamicChains.values()) {
    if (c.networkId === networkId) return c;
  }
  return undefined;
}

/** Get all chains in a family */
export function getChainsByFamily(family: ChainFamily): ChainDescriptor[] {
  const result: ChainDescriptor[] = [];
  for (const c of registry.values()) if (c.family === family) result.push(c);
  for (const c of dynamicChains.values()) if (c.family === family) result.push(c);
  return result;
}

/** Get all enabled chains */
export function getEnabledChains(): ChainDescriptor[] {
  const result: ChainDescriptor[] = [];
  for (const c of registry.values()) if (c.enabled) result.push(c);
  for (const c of dynamicChains.values()) if (c.enabled) result.push(c);
  return result;
}

/** Get all chains by network type */
export function getChainsByType(type: NetworkType): ChainDescriptor[] {
  const result: ChainDescriptor[] = [];
  const all = [...registry.values(), ...dynamicChains.values()];
  for (const c of all) if (c.networkType === type) result.push(c);
  return result;
}

/** Register a custom chain at runtime (user-added RPCs, appchains, etc.) */
export function registerChain(chain: ChainDescriptor): void {
  dynamicChains.set(chain.chainId, chain);
}

/** Load 2500+ EVM chains from allchain API / chainid.network CDN */
export async function loadAllchains(): Promise<number> {
  if (allchainLoaded) return dynamicChains.size;

  let entries: AllchainEntry[] = [];

  // Tier 1: try agenticplace backend
  try {
    const res = await fetch(`${ALLCHAIN_API}/api/chains`);
    if (res.ok) entries = await res.json();
  } catch { /* fall through */ }

  // Tier 2: chainid.network CDN fallback
  if (!entries.length) {
    try {
      const res = await fetch(CHAINID_CDN);
      if (res.ok) entries = await res.json();
    } catch { /* fall through */ }
  }

  for (const entry of entries) {
    const id = `evm-${entry.chainId}`;
    // Don't overwrite static entries
    if (registry.has(id) || dynamicChains.has(id)) continue;
    // Skip if we already have this by networkId
    if (getChainByNetworkId(entry.chainId)) continue;

    const descriptor: ChainDescriptor = {
      chainId: id,
      family: 'evm',
      name: entry.name,
      networkId: entry.chainId,
      networkType: classifyNetwork(entry.name, entry.chainId),
      ticker: entry.nativeCurrency?.symbol ?? 'ETH',
      decimals: entry.nativeCurrency?.decimals ?? 18,
      rpcUrl: entry.rpc?.[0],
      explorerUrl: entry.explorers?.[0]?.url,
      enabled: true,
    };

    dynamicChains.set(id, descriptor);
  }

  allchainLoaded = true;
  return dynamicChains.size;
}

/** Total chain count (static + dynamic) */
export function chainCount(): number {
  return registry.size + dynamicChains.size;
}
