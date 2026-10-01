// Chain registry — one descriptor per chain the wallet can show as a
// first-class wallet. The dashboard and the wallet switcher read this so
// neither hard-codes chain knowledge: adding a chain is one entry here.
//
// Keys match the ids used in WalletAccount.chains (e.g. solana-create writes
// `solana`, arweave-create writes `arweave-hd`). `arweave` is kept as an
// alias so legacy accounts resolve too.
//
// This module is reachable from the eager dashboard bundle, so balance
// fetchers `import()` their chain libs lazily — arweave-js in particular is
// ~290 KB and must stay out of the first-paint chunk.

import type { ChainId } from './pouch/types';

export interface ChainBalance {
  /** Human-readable amount with unit, e.g. "1.234 SOL". */
  display: string;
}

// Address-format family — chains that share one share an address format
// (Phantom's `AddressType` grouping). EVM/Bitcoin/Sui are listed for forward
// compatibility even though PARSEC doesn't surface them as wallets yet.
export type ChainAddressType =
  | 'algorand'
  | 'solana'
  | 'arweave'
  | 'evm'
  | 'bitcoin'
  | 'unknown';

export interface ChainDescriptor {
  id: string;
  label: string;
  /** Native unit ticker. */
  unit: string;
  /** CAIP-2 chain identifier (Phantom convention, e.g. `solana:101`). */
  caip2: string;
  /** Address-format family — see ChainAddressType. */
  addressType: ChainAddressType;
  /** CoinGecko coin id for the native asset price (header price tag). */
  priceId?: string;
  /** AppView to navigate to for sending on this chain, if supported. */
  sendView?: string;
  /** Mid-truncate an address for compact display. */
  truncate(addr: string): string;
  /** External explorer URL for an address. */
  explorerUrl(addr: string): string;
  /** Fetch the on-chain balance. Absent → balance is not shown. */
  balance?(addr: string): Promise<ChainBalance>;
}

function midTruncate(addr: string): string {
  return addr.length > 18 ? `${addr.slice(0, 8)}…${addr.slice(-8)}` : addr;
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

const DESCRIPTORS: Record<string, ChainDescriptor> = {
  algorand: {
    id: 'algorand',
    label: 'Algorand',
    unit: 'ALGO',
    caip2: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k',
    addressType: 'algorand',
    priceId: 'algorand',
    sendView: 'send',
    truncate: midTruncate,
    explorerUrl: (a) => `https://allo.info/account/${a}`,
  },
  solana: {
    id: 'solana',
    label: 'Solana',
    unit: 'SOL',
    caip2: 'solana:101',
    addressType: 'solana',
    priceId: 'solana',
    sendView: 'solana-send',
    truncate: midTruncate,
    explorerUrl: (a) => `https://explorer.solana.com/address/${a}`,
    balance: async (a) => {
      const { fetchSolBalance } = await import('./solana/balance');
      return { display: `${fmt(await fetchSolBalance(a))} SOL` };
    },
  },
  'arweave-hd': {
    id: 'arweave-hd',
    label: 'Arweave',
    unit: 'AR',
    caip2: 'arweave:mainnet',
    addressType: 'arweave',
    priceId: 'arweave',
    sendView: 'arweave-send',
    truncate: midTruncate,
    explorerUrl: (a) => `https://viewblock.io/arweave/address/${a}`,
    balance: async (a) => {
      const { getArBalance } = await import('./arweave/client');
      return { display: `${fmt(Number(await getArBalance(a)))} AR` };
    },
  },
};

// `arweave` resolves to the same descriptor as the HD variant.
DESCRIPTORS['arweave'] = { ...DESCRIPTORS['arweave-hd'], id: 'arweave' };

/** Descriptor for a chain id, with a generic fallback for unknown chains. */
export function getChainDescriptor(id: ChainId): ChainDescriptor {
  return (
    DESCRIPTORS[id] ?? {
      id,
      label: String(id),
      unit: '',
      caip2: '',
      addressType: 'unknown',
      truncate: midTruncate,
      explorerUrl: () => '#',
    }
  );
}

/** Whether a chain id has a first-class descriptor. */
export function isKnownChain(id: ChainId): boolean {
  return id in DESCRIPTORS;
}
