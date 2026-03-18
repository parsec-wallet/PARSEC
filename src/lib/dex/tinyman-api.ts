// SpinTrade — Tinyman API Module
// Uses Tinyman's analytics API for pool discovery and quotes.
// This is a centralized API reference — convenient but not sovereign.
// Participant should be aware: data comes from Tinyman's server, not the chain.

import type { NetworkId } from '../../types/wallet';
import type { DexModule, DexQuote, DexAsset } from './types';

const TINYMAN_API: Record<string, string> = {
  mainnet: 'https://mainnet.analytics.tinyman.org/api/v1',
  testnet: 'https://testnet.analytics.tinyman.org/api/v1',
};

async function tinymanFetch(network: NetworkId, path: string): Promise<unknown> {
  const base = TINYMAN_API[network];
  if (!base) return null;
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) return null;
  return response.json();
}

export const tinymanApiModule: DexModule = {
  id: 'tinyman-api',
  name: 'Tinyman (API)',
  enabled: false, // Centralized API — disabled by default. On-chain module is primary.

  async fetchPairsForAsset(assetId: number, network: NetworkId): Promise<DexAsset[]> {
    const data = await tinymanFetch(network,
      `/pools/?asset_1=${assetId}&with_liquidity=true&ordering=-liquidity_in_usd&limit=20`
    ) as { results?: Record<string, unknown>[] } | null;
    if (!data?.results) return [];

    const assets: DexAsset[] = [];
    for (const pool of data.results) {
      const a1 = pool.asset_1 as Record<string, unknown> | undefined;
      const a2 = pool.asset_2 as Record<string, unknown> | undefined;
      const other = Number(a1?.id) === assetId ? a2 : a1;
      if (other && !assets.some(a => a.assetId === Number(other.id))) {
        assets.push({
          assetId: Number(other.id),
          unitName: String(other.unit_name || ''),
          name: String(other.name || ''),
          decimals: Number(other.decimals ?? 6),
        });
      }
    }
    return assets;
  },

  async getQuote(inputAssetId, outputAssetId, inputAmount, slippageBps, network): Promise<DexQuote | null> {
    const data = await tinymanFetch(network,
      `/pools/?asset_1=${inputAssetId}&asset_2=${outputAssetId}`
    ) as { results?: Record<string, unknown>[] } | null;
    if (!data?.results?.[0]) return null;

    const pool = data.results[0];
    const a1 = pool.asset_1 as Record<string, unknown>;
    const isAsset1Input = Number(a1.id) === inputAssetId;
    const inputReserve = Number(isAsset1Input ? pool.current_asset_1_reserves : pool.current_asset_2_reserves);
    const outputReserve = Number(isAsset1Input ? pool.current_asset_2_reserves : pool.current_asset_1_reserves);

    if (inputReserve === 0 || outputReserve === 0) return null;

    const feeRate = 0.003;
    const inputAfterFee = inputAmount * (1 - feeRate);
    const outputAmount = Math.floor((outputReserve * inputAfterFee) / (inputReserve + inputAfterFee));
    const minOutput = Math.floor(outputAmount * (1 - slippageBps / 10000));

    return {
      inputAssetId, outputAssetId, inputAmount, outputAmount,
      priceImpact: (inputAmount / inputReserve) * 100,
      exchangeRate: inputAmount > 0 ? outputAmount / inputAmount : 0,
      fee: Math.floor(inputAmount * feeRate),
      minOutput,
      poolAddress: String(pool.address || ''),
      dex: 'Tinyman (API)',
    };
  },

  async executeSwap(): Promise<{ txId: string }> {
    // API module does not execute — on-chain module handles execution
    throw new Error('Use on-chain module for execution');
  },
};
