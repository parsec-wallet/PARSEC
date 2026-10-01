// Query cache + in-flight dedup + per-endpoint rate limiter for Algorand
// indexer / algod calls. Pattern adapted from AlgoNode/algostack's Query
// module — reimplemented in parsec style (in-memory only, vanilla TS, no
// external storage).
//
// All cached data is public on-chain; no secret material is involved.

import { pRateLimit } from 'p-ratelimit';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Most entries kept. Keys include asset, NFT and transaction queries, so the
 * map grew with everything ever looked at; expired entries were never removed.
 */
const MAX_ENTRIES = 500;

function evict(now: number): void {
  if (cache.size <= MAX_ENTRIES) return;
  for (const [k, e] of cache) if (e.expiresAt <= now) cache.delete(k);
  // Still over: Map iterates in insertion order, so the first keys are oldest.
  for (const k of cache.keys()) {
    if (cache.size <= MAX_ENTRIES) break;
    cache.delete(k);
  }
}
const inflight = new Map<string, Promise<unknown>>();

/**
 * Per-endpoint rate limiters. Defaults are conservative for the public
 * AlgoNode endpoints (mainnet-idx.algonode.cloud etc.). Override by
 * passing a different `endpoint` key for self-hosted indexers.
 */
const limiters = new Map<string, ReturnType<typeof pRateLimit>>();

const DEFAULT_QUOTA = { interval: 1000, rate: 30, concurrency: 10 } as const;

export function getRateLimiter(endpoint: string): ReturnType<typeof pRateLimit> {
  let limiter = limiters.get(endpoint);
  if (!limiter) {
    limiter = pRateLimit(DEFAULT_QUOTA);
    limiters.set(endpoint, limiter);
  }
  return limiter;
}

/**
 * Coalesce concurrent calls with the same key into a single promise.
 * Returns immediately if an identical request is already in flight.
 */
export function inflightDedupe<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = fetchFn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/**
 * Cache + dedup wrapper. Returns the cached value if fresh; otherwise runs
 * `fetchFn`, caches the result with TTL, and returns it. Concurrent calls
 * for the same key share a single in-flight fetch.
 */
export async function queryCache<T>(
  key: string,
  ttlMs: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;
  if (hit) cache.delete(key);

  return inflightDedupe(key, async () => {
    const value = await fetchFn();
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    evict(Date.now());
    return value;
  });
}

/**
 * Wrap a fetch function with both rate-limiting (per endpoint) and
 * cache+dedup (per key). The common case for indexer/algod queries.
 */
export async function rateLimitedQuery<T>(
  endpoint: string,
  key: string,
  ttlMs: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const limiter = getRateLimiter(endpoint);
  return queryCache(key, ttlMs, () => limiter(fetchFn));
}

/** Drop a single cache entry (e.g. after a write that invalidates it). */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/** Drop all entries whose key starts with `prefix`. */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Forget every cached read and in-flight dedupe. Called on logout. */
export function clearQueryCache(): void {
  cache.clear();
  inflight.clear();
}

/** Test-only: clear everything. */
export function _resetQueryCache(): void {
  cache.clear();
  inflight.clear();
  limiters.clear();
}
