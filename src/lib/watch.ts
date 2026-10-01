// Parsec Wallet — Blue Pill wallet watching
//
// The Blue Pill watches wallets. It never interacts with them: no key is
// touched, nothing is signed, no dApp session is opened, no transaction is
// built. It reads public balances from public endpoints, and that is all this
// module can do. The Red Pill is where wallets are logged into.
//
// Watching is still an external read: each endpoint learns which address was
// asked about. The UI says so beside every watched wallet.
//
// Balances are exact. Every amount stays a bigint in base units from the wire
// to lib/money.ts formatDecimal, which is the only place rounding happens. JSON
// numbers are never trusted for an amount — an Algorand or Solana balance can
// exceed 2^53 — so amounts are lifted from the response text as digits.

import { formatDecimal } from './money';
import type { ValidationResult } from './validate';

export type WatchChain = 'algorand' | 'solana' | 'arweave' | 'bitcoin' | 'evm';

export interface WatchedWallet {
  chain: WatchChain;
  address: string;
  label: string;
}

export interface WatchReading {
  /** Network the balance was read on — 'Algorand', 'Arbitrum', … */
  network: string;
  unit: string;
  decimals: number;
  /** Base units. `null` when the read failed — unknown, never zero. */
  raw: bigint | null;
  error?: string;
}

export const WATCH_CHAIN_LABEL: Readonly<Record<WatchChain, string>> = {
  algorand: 'Algorand',
  solana: 'Solana',
  arweave: 'Arweave',
  bitcoin: 'Bitcoin',
  evm: 'EVM',
};

/** EVM networks an EVM address is read on — the ones the Parsec profile watches. */
export const EVM_NETWORKS: ReadonlyArray<{ name: string; unit: string; rpc: string }> = [
  { name: 'Ethereum', unit: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com' },
  { name: 'Arbitrum', unit: 'ETH', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { name: 'Optimism', unit: 'ETH', rpc: 'https://optimism-rpc.publicnode.com' },
  { name: 'Base', unit: 'ETH', rpc: 'https://base-rpc.publicnode.com' },
  { name: 'Polygon', unit: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { name: 'Blast', unit: 'ETH', rpc: 'https://blast-rpc.publicnode.com' },
  { name: 'HyperEVM', unit: 'HYPE', rpc: 'https://rpc.hyperliquid.xyz/evm' },
];

// ── Classification (a suggestion — see confirmChain) ─────────────────────────

const PATTERNS: ReadonlyArray<[WatchChain, RegExp]> = [
  ['evm', /^0x[0-9a-fA-F]{40}$/],
  ['algorand', /^[A-Z2-7]{58}$/],
  ['bitcoin', /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/],
  ['solana', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/],
  ['arweave', /^[A-Za-z0-9_-]{43}$/],
];

/**
 * Every chain whose address format this string fits, most specific first.
 *
 * More than one is normal: a 43-character base58 string is a valid shape for
 * both Solana and Arweave. The participant picks; this never guesses silently.
 */
export function classifyAddress(input: string): WatchChain[] {
  const a = input.trim();
  return PATTERNS.filter(([, re]) => re.test(a)).map(([c]) => c);
}

/**
 * Confirm a suggested chain with the Rust validators.
 *
 * The frontend classifies; Rust decides (CLAUDE.md non-negotiable 2). Arweave
 * has no Rust validator, so it stands on its format, and the result says so.
 */
export async function confirmChain(
  chain: WatchChain,
  address: string,
  validators: {
    algorand: (a: string) => Promise<ValidationResult>;
    solana: (a: string) => Promise<ValidationResult>;
    bitcoin: (a: string) => Promise<ValidationResult>;
    evm: (a: string) => Promise<ValidationResult>;
  },
): Promise<{ ok: boolean; reason: string }> {
  const a = address.trim();
  if (!classifyAddress(a).includes(chain)) return { ok: false, reason: `Not a ${WATCH_CHAIN_LABEL[chain]} address format.` };
  if (chain === 'arweave') return { ok: true, reason: 'Format valid. Arweave has no checksum to verify.' };
  try {
    const r = await validators[chain](a);
    return { ok: r.valid, reason: r.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Validation failed.' };
  }
}

/** A watched wallet made safe to store and use, or null. */
export function sanitizeWatched(raw: unknown): WatchedWallet | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const chain = r.chain;
  const address = typeof r.address === 'string' ? r.address.trim() : '';
  if (chain !== 'algorand' && chain !== 'solana' && chain !== 'arweave' && chain !== 'bitcoin' && chain !== 'evm') return null;
  if (!classifyAddress(address).includes(chain)) return null;
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, 40) : '';
  return { chain, address, label };
}

// ── Reading ──────────────────────────────────────────────────────────────────

type Fetch = typeof fetch;

/** Digits of a JSON field, read from the raw text so no precision is lost. */
export function digitsOf(text: string, field: string): bigint | null {
  const m = new RegExp(`"${field}"\\s*:\\s*"?(\\d+)"?`).exec(text);
  return m ? BigInt(m[1]) : null;
}

async function rpc(f: Fetch, url: string, method: string, params: unknown[]): Promise<string> {
  const res = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function one(network: string, unit: string, decimals: number, read: () => Promise<bigint | null>): Promise<WatchReading> {
  try {
    const raw = await read();
    return raw === null
      ? { network, unit, decimals, raw: null, error: 'No balance in the response.' }
      : { network, unit, decimals, raw };
  } catch (e) {
    return { network, unit, decimals, raw: null, error: e instanceof Error ? e.message : 'Read failed.' };
  }
}

/** Read a watched wallet's native balances. Read-only; one reading per network. */
export async function readWatched(w: WatchedWallet, f: Fetch = (...a) => fetch(...a)): Promise<WatchReading[]> {
  const a = encodeURIComponent(w.address);
  switch (w.chain) {
    case 'algorand':
      return [await one('Algorand', 'ALGO', 6, async () => {
        const res = await f(`https://mainnet-api.algonode.cloud/v2/accounts/${a}?exclude=all`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return digitsOf(await res.text(), 'amount');
      })];
    case 'solana':
      return [await one('Solana', 'SOL', 9, async () =>
        digitsOf(await rpc(f, 'https://solana-rpc.publicnode.com', 'getBalance', [w.address]), 'value'))];
    case 'arweave':
      return [await one('Arweave', 'AR', 12, async () => {
        const res = await f(`https://arweave.net/wallet/${a}/balance`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const t = (await res.text()).trim();
        return /^\d+$/.test(t) ? BigInt(t) : null;
      })];
    case 'bitcoin':
      return [await one('Bitcoin', 'BTC', 8, async () => {
        const res = await f(`https://mempool.space/api/address/${a}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const t = await res.text();
        const chainStats = /"chain_stats"\s*:\s*\{([^}]*)\}/.exec(t)?.[1] ?? '';
        const funded = digitsOf(`{${chainStats}}`, 'funded_txo_sum');
        const spent = digitsOf(`{${chainStats}}`, 'spent_txo_sum');
        return funded === null || spent === null ? null : funded - spent;
      })];
    case 'evm':
      return Promise.all(EVM_NETWORKS.map((n) => one(n.name, n.unit, 18, async () => {
        const hex = /"result"\s*:\s*"(0x[0-9a-fA-F]*)"/.exec(await rpc(f, n.rpc, 'eth_getBalance', [w.address, 'latest']))?.[1];
        return hex === undefined ? null : BigInt(hex === '0x' ? '0x0' : hex);
      })));
  }
}

/** Display a reading: exact, up to eight fraction digits (a whole satoshi), or a dash when unknown. */
export function formatReading(r: WatchReading): string {
  if (r.raw === null) return '—';
  return `${formatDecimal(r.raw, r.decimals, { maxFractionDigits: 8 })} ${r.unit}`;
}

/** Mid-truncate an address for display. */
export function shortAddress(a: string): string {
  return a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-8)}` : a;
}
