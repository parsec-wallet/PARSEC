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
    set(reverse, key, nfd);
    return nfd;
  } catch {
    set(reverse, key, null);
    return null;
  }
}

/** Drop cached entries — call when the user mints, transfers, or switches networks. */
export function invalidateNfdCaches(): void {
  forward.clear();
  reverse.clear();
}

/** Shorthand for the common "name or truncated address" display. */
export function displayName(nfd: Nfd | null, address: string): string {
  if (nfd) return nfd.name;
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
