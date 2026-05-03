import { describe, it, expect, beforeEach } from 'vitest';
import {
  queryCache,
  inflightDedupe,
  rateLimitedQuery,
  invalidateCache,
  invalidateCachePrefix,
  _resetQueryCache,
} from '../query-cache';

describe('query-cache', () => {
  beforeEach(() => {
    _resetQueryCache();
  });

  describe('queryCache', () => {
    it('caches a value for the given TTL', async () => {
      let calls = 0;
      const fetchFn = async () => {
        calls++;
        return 'value';
      };
      const a = await queryCache('k1', 1000, fetchFn);
      const b = await queryCache('k1', 1000, fetchFn);
      expect(a).toBe('value');
      expect(b).toBe('value');
      expect(calls).toBe(1);
    });

    it('refetches after TTL expires', async () => {
      let calls = 0;
      const fetchFn = async () => {
        calls++;
        return calls;
      };
      const a = await queryCache('k2', 5, fetchFn);
      await new Promise((r) => setTimeout(r, 15));
      const b = await queryCache('k2', 5, fetchFn);
      expect(a).toBe(1);
      expect(b).toBe(2);
    });

    it('isolates entries by key', async () => {
      const a = await queryCache('a', 1000, async () => 'A');
      const b = await queryCache('b', 1000, async () => 'B');
      expect(a).toBe('A');
      expect(b).toBe('B');
    });
  });

  describe('inflightDedupe', () => {
    it('coalesces concurrent calls into one fetch', async () => {
      let calls = 0;
      const fetchFn = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return 'x';
      };
      const results = await Promise.all([
        inflightDedupe('same', fetchFn),
        inflightDedupe('same', fetchFn),
        inflightDedupe('same', fetchFn),
      ]);
      expect(results).toEqual(['x', 'x', 'x']);
      expect(calls).toBe(1);
    });

    it('clears inflight entry after completion so the next call refetches', async () => {
      let calls = 0;
      const fetchFn = async () => {
        calls++;
        return calls;
      };
      await inflightDedupe('once', fetchFn);
      await inflightDedupe('once', fetchFn);
      expect(calls).toBe(2);
    });
  });

  describe('rateLimitedQuery', () => {
    it('caps requests through the per-endpoint rate limiter', async () => {
      let calls = 0;
      const fetchFn = async () => {
        calls++;
        return calls;
      };
      // Fire 5 distinct keys against the same endpoint; all should resolve.
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map((i) =>
          rateLimitedQuery('http://test', `k-${i}`, 1000, fetchFn),
        ),
      );
      expect(results.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('still caches between calls', async () => {
      let calls = 0;
      const fetchFn = async () => {
        calls++;
        return 'cached';
      };
      await rateLimitedQuery('http://test', 'cache-me', 1000, fetchFn);
      await rateLimitedQuery('http://test', 'cache-me', 1000, fetchFn);
      expect(calls).toBe(1);
    });
  });

  describe('invalidation', () => {
    it('invalidateCache removes a single entry', async () => {
      let calls = 0;
      const fetchFn = async () => {
        calls++;
        return 'v';
      };
      await queryCache('inv', 60_000, fetchFn);
      invalidateCache('inv');
      await queryCache('inv', 60_000, fetchFn);
      expect(calls).toBe(2);
    });

    it('invalidateCachePrefix drops matching keys', async () => {
      const fetchFn = async () => 'v';
      await queryCache('asset:1', 60_000, fetchFn);
      await queryCache('asset:2', 60_000, fetchFn);
      await queryCache('nfd:foo', 60_000, fetchFn);
      invalidateCachePrefix('asset:');
      let calls = 0;
      const counter = async () => {
        calls++;
        return 'v';
      };
      await queryCache('asset:1', 60_000, counter);
      await queryCache('asset:2', 60_000, counter);
      await queryCache('nfd:foo', 60_000, counter);
      // asset:1 and asset:2 were dropped → refetched. nfd:foo stayed cached.
      expect(calls).toBe(2);
    });
  });
});
