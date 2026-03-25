// Parsec x402 Integration — Price Oracle
// Algorand DEX price oracle via Vestige API (Tinyman/Pact/Folks pools).
// Augments the CoinGecko-only prices.ts with Algorand-native pricing.
// (c) 2026 BANKON — GPL-3.0

import { VESTIGE_API, FALLBACK_ALGO_USD, DEFAULT_CACHE_TTL } from './constants';

export class PriceOracle {
  private cachedAlgoUsd = FALLBACK_ALGO_USD;
  private cacheTimestamp = 0;
  private readonly cacheTtl: number;

  constructor(cacheTtl = DEFAULT_CACHE_TTL) {
    this.cacheTtl = cacheTtl;
  }

  /** Get current ALGO/USD price (cached) */
  async getAlgoUsd(): Promise<number> {
    if (Date.now() - this.cacheTimestamp < this.cacheTtl && this.cachedAlgoUsd > 0) {
      return this.cachedAlgoUsd;
    }
    try {
      const res = await fetch(`${VESTIGE_API}/asset/0/price`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as { price?: number };
        if (data.price && data.price > 0) {
          this.cachedAlgoUsd = data.price;
          this.cacheTimestamp = Date.now();
        }
      }
    } catch {
      /* use cached */
    }
    return this.cachedAlgoUsd;
  }

  /** Convert USD to microALGO */
  async usdToMicroAlgo(usd: number): Promise<number> {
    const algoUsd = await this.getAlgoUsd();
    return Math.ceil((usd / algoUsd) * 1e6);
  }

  /** Convert USD to ALGO */
  async usdToAlgo(usd: number): Promise<number> {
    const algoUsd = await this.getAlgoUsd();
    return +(usd / algoUsd).toFixed(6);
  }

  /** Get price for any ASA by asset ID (0 = ALGO native) */
  async getAssetPrice(asaId: number): Promise<{ usd: number; algo: number; source: string }> {
    if (asaId === 0) {
      const usd = await this.getAlgoUsd();
      return { usd, algo: 1, source: 'vestige' };
    }
    try {
      const res = await fetch(`${VESTIGE_API}/asset/${asaId}/price`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as { price?: number; price_algo?: number };
        return {
          usd: data.price || 0,
          algo: data.price_algo || 0,
          source: 'vestige',
        };
      }
    } catch {
      /* fall through */
    }
    return { usd: 0, algo: 0, source: 'unavailable' };
  }

  /** Get BANKON token price (ASA 203977300) */
  async getBankonPrice(): Promise<{ usd: number; algo: number; source: string }> {
    return this.getAssetPrice(203977300);
  }

  /** Cache age in milliseconds */
  get cacheAge(): number {
    return Date.now() - this.cacheTimestamp;
  }

  /** Whether oracle data is fresh (within TTL) */
  get isFresh(): boolean {
    return this.cacheAge < this.cacheTtl;
  }

  /** Current cached price (no fetch) */
  get currentPrice(): number {
    return this.cachedAlgoUsd;
  }

  /** Force cache refresh on next call */
  invalidate(): void {
    this.cacheTimestamp = 0;
  }
}
