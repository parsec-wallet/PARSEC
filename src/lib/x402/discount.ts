// Parsec x402 Integration — BANKON Holder Discount
// Checks BANKON ASA 203977300 balance on Algorand for 50% fee discount.
// 5-minute per-address cache to avoid excessive indexer queries.
// (c) 2026 BANKON — GPL-3.0

import { ALGO_INDEXER_URL, BANKON_ASA_ID, DEFAULT_DISCOUNT_PCT } from './constants';
import type { HolderStatus } from './types';

const HOLDER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedHolder {
  status: HolderStatus;
  timestamp: number;
}

const holderCache = new Map<string, CachedHolder>();

/**
 * Check if an Algorand address holds BANKON (or any ASA).
 * BANKON supply: 10,000,000 (0 decimals, whole units).
 * Results cached 5 minutes per address+asaId pair.
 */
export async function checkBankonHolder(
  address: string,
  asaId = BANKON_ASA_ID,
  minBalance = 1,
): Promise<HolderStatus> {
  const cacheKey = `${address}:${asaId}`;
  const cached = holderCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < HOLDER_CACHE_TTL) {
    return cached.status;
  }

  let status: HolderStatus = { isHolder: false, balance: 0 };
  try {
    const url = `${ALGO_INDEXER_URL}/v2/accounts/${address}/assets?asset-id=${asaId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = (await res.json()) as { assets?: Array<{ amount: number }> };
      const asset = data.assets?.[0];
      if (asset) {
        status = {
          isHolder: asset.amount >= minBalance,
          balance: asset.amount,
        };
      }
    }
  } catch {
    /* treat as non-holder */
  }

  holderCache.set(cacheKey, { status, timestamp: Date.now() });
  return status;
}

/** Calculate effective price after holder discount */
export function applyDiscount(
  priceUsd: number,
  isHolder: boolean,
  discountPct = DEFAULT_DISCOUNT_PCT,
): number {
  if (!isHolder || discountPct <= 0) return priceUsd;
  return +(priceUsd * (1 - discountPct / 100)).toFixed(6);
}

/** Clear holder cache (for testing) */
export function clearHolderCache(): void {
  holderCache.clear();
}
