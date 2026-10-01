// Forward and reverse NFD lookup with a small LRU cache so the dashboard
// can render ".algo" names next to addresses without a fetch per render.

import type { NetworkId } from '../../types/wallet';
import { getNfdClient } from './client';
import type { Nfd } from './types';

type CacheKey = `${NetworkId}:${string}`;

const TTL_MS = 600_000;
const MAX = 512;

interface Entry {
  value: Nfd | null;
  at: number;
}

const forward = new Map<CacheKey, Entry>();
const reverse = new Map<CacheKey, Entry>();
const lookup = new Map<CacheKey, Entry>();

// NFD lookup API per network. Mainnet and testnet have separate registries;
// betanet has no NFD deployment so it shares the testnet endpoint.
const NFD_API_BASE: Record<NetworkId, string> = {
  mainnet: 'https://api.nf.domains',
  testnet: 'https://api.testnet.nf.domains',
  betanet: 'https://api.testnet.nf.domains',
};

function get(cache: Map<CacheKey, Entry>, key: CacheKey): Nfd | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // LRU touch
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function set(cache: Map<CacheKey, Entry>, key: CacheKey, value: Nfd | null) {
  cache.set(key, { value, at: Date.now() });
  while (cache.size > MAX) {
    const first = cache.keys().next().value;
    if (!first) break;
    cache.delete(first);
  }
}

/** Resolve a name to its NFD record. Returns null when the name is not minted. */
export async function resolveName(
  network: NetworkId,
  name: string,
): Promise<Nfd | null> {
  const key: CacheKey = `${network}:${name}`;
  const cached = get(forward, key);
  if (cached !== undefined) return cached;
  try {
    const nfd = await getNfdClient(network).resolve(name, { view: 'brief' });
    set(forward, key, nfd);
    return nfd;
  } catch {
    set(forward, key, null);
    return null;
  }
}

/**
 * True existence check for a name — is it registered in the NFD registry,
 * in ANY state?
 *
 * This is NOT resolveName(). resolveName() resolves a name to an *address*
 * via the SDK and so reports an owned-but-bare name (one with no address
 * records configured) as "not found" — which is wrong for an availability
 * gate: such a name is taken and cannot be minted. `bankon.algo` is exactly
 * that case.
 *
 * Here we hit the NFD lookup endpoint directly. HTTP 200 → the name is
 * registered (state may be `owned`, `expired`, `forSale`, `reserved`, …);
 * HTTP 404 → the name was never minted and is genuinely mintable.
 *
 * Throws on network/HTTP errors so a failed check is never silently treated
 * as "available" — the caller must surface it and block the mint.
 */
export async function lookupNfd(
  network: NetworkId,
  name: string,
): Promise<Nfd | null> {
  const key: CacheKey = `${network}:${name}`;
  const cached = get(lookup, key);
  if (cached !== undefined) return cached;

  const base = NFD_API_BASE[network] ?? NFD_API_BASE.mainnet;
  const res = await fetch(`${base}/nfd/${encodeURIComponent(name)}?view=brief`);
  if (res.status === 404) {
    set(lookup, key, null);
    return null;
  }
  if (!res.ok) {
    throw new Error(`NFD lookup failed (HTTP ${res.status}) — cannot verify availability.`);
  }
  const nfd = (await res.json()) as Nfd;
  set(lookup, key, nfd);
  return nfd;
}

/** Return the primary NFD for an address, if any. */
export async function resolveAddress(
  network: NetworkId,
  address: string,
): Promise<Nfd | null> {
  const key: CacheKey = `${network}:${address}`;
  const cached = get(reverse, key);
  if (cached !== undefined) return cached;
  try {
    const nfd = await getNfdClient(network).resolveAddress(address);
    // Only cache a real result (a hit, or a genuine "no NFD"). A transient
    // failure must NOT be cached as null — that would hide a primary name
    // for the whole TTL after a single network hiccup.
    set(reverse, key, nfd);
    return nfd;
  } catch {
    return null;
  }
}

/** Drop cached entries — call when the user mints, transfers, or switches networks. */
export function invalidateNfdCaches(): void {
  forward.clear();
  reverse.clear();
  lookup.clear();
}

/** Shorthand for the common "name or truncated address" display. */
export function displayName(nfd: Nfd | null, address: string): string {
  if (nfd) return nfd.name;
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
