// SpinTrade — DEX Aggregator
// Queries all enabled DEX modules. Returns the best price.
// Participant sees all quotes and chooses their path.

import type { NetworkId } from '../../types/wallet';
import type { DexModule, DexQuote, DexAsset } from './types';
import { tinymanOnchainModule } from './tinyman-onchain';
import { tinymanApiModule } from './tinyman-api';

// Registry of all DEX modules — add new DEX here
const DEX_MODULES: DexModule[] = [
  tinymanOnchainModule,
  tinymanApiModule,
  // Future: pactModule, folksModule, spintradeModule
];

/** Get all enabled DEX modules */
export function getEnabledDex(): DexModule[] {
  return DEX_MODULES.filter(m => m.enabled);
}

/** Fetch tradeable pairs from all enabled DEX sources, deduplicated */
export async function fetchAllPairs(
  assetId: number,
  network: NetworkId,
): Promise<DexAsset[]> {
  const enabled = getEnabledDex();
  const allAssets: DexAsset[] = [];
  const seenIds = new Set<number>();

  // Query all DEX modules in parallel
  const results = await Promise.allSettled(
    enabled.map(dex => dex.fetchPairsForAsset(assetId, network))
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const asset of result.value) {
        if (!seenIds.has(asset.assetId)) {
          seenIds.add(asset.assetId);
          allAssets.push(asset);
        }
      }
    }
  }

  return allAssets;
}

/** Get quotes from all enabled DEX modules — participant compares */
export async function fetchAllQuotes(
  inputAssetId: number,
  outputAssetId: number,
  inputAmount: number,
  slippageBps: number,
  network: NetworkId,
): Promise<DexQuote[]> {
  const enabled = getEnabledDex();
  const quotes: DexQuote[] = [];

  const results = await Promise.allSettled(
    enabled.map(dex => dex.getQuote(inputAssetId, outputAssetId, inputAmount, slippageBps, network))
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      quotes.push(result.value);
    }
  }

  // Sort by best output (most tokens received = best price)
  quotes.sort((a, b) => b.outputAmount - a.outputAmount);

  return quotes;
}

/** Execute swap through a specific DEX module */
export async function executeSwapViaDex(
  dexId: string,
  mnemonic: string,
  inputAssetId: number,
  outputAssetId: number,
  inputAmount: number,
  minOutputAmount: number,
  poolAddress: string,
  network: NetworkId,
): Promise<{ txId: string }> {
  const dex = DEX_MODULES.find(m => m.id === dexId);
  if (!dex) throw new Error(`DEX module not found: ${dexId}`);
  return dex.executeSwap(mnemonic, inputAssetId, outputAssetId, inputAmount, minOutputAmount, poolAddress, network);
}
