// SpinTrade — DEX Aggregator
// Queries all enabled DEX modules. Returns the best price.
// Participant sees all quotes and chooses their path.

import type { NetworkId } from '../../types/wallet';
import type { DexModule, DexQuote, DexAsset, SwapSigner } from './types';
import { tinymanOnchainModule } from './tinyman-onchain';
import { tinymanApiModule } from './tinyman-api';
import { pactModule } from './pact';

// Registry of all DEX modules — add new DEX here
const DEX_MODULES: DexModule[] = [
  tinymanOnchainModule,
  tinymanApiModule,
  pactModule,
  // Future: folksModule, spintradeModule
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

// ── Multi-Hop Routing ──────────────────────────────────────────
// If no direct pool exists for ASA_A → ASA_B, route through ALGO:
//   ASA_A → ALGO (hop 1) → ASA_B (hop 2)
// Returns the best quote: direct if available, multi-hop if better or only option.

const ALGO_ID = 0; // native ALGO asset ID

export interface MultiHopQuote extends DexQuote {
  isMultiHop: boolean;
  hops: DexQuote[];
}

/**
 * Get the best quote including multi-hop routes.
 * Checks direct ASA_A → ASA_B first.
 * If no direct route or multi-hop gives better output, returns the multi-hop.
 */
export async function fetchBestQuote(
  inputAssetId: number,
  outputAssetId: number,
  inputAmount: number,
  slippageBps: number,
  network: NetworkId,
): Promise<MultiHopQuote | null> {
  // Skip multi-hop if one side is already ALGO
  if (inputAssetId === ALGO_ID || outputAssetId === ALGO_ID) {
    const directQuotes = await fetchAllQuotes(inputAssetId, outputAssetId, inputAmount, slippageBps, network);
    if (directQuotes.length > 0) {
      return { ...directQuotes[0], isMultiHop: false, hops: [directQuotes[0]] };
    }
    return null;
  }

  // Try direct route and multi-hop in parallel
  const [directQuotes, hop1Quotes] = await Promise.all([
    fetchAllQuotes(inputAssetId, outputAssetId, inputAmount, slippageBps, network),
    fetchAllQuotes(inputAssetId, ALGO_ID, inputAmount, slippageBps, network),
  ]);

  // Best direct quote
  const bestDirect = directQuotes.length > 0 ? directQuotes[0] : null;

  // Multi-hop: ASA_A → ALGO → ASA_B
  let bestMultiHop: MultiHopQuote | null = null;
  if (hop1Quotes.length > 0) {
    const algoReceived = hop1Quotes[0].outputAmount;
    if (algoReceived > 0) {
      const hop2Quotes = await fetchAllQuotes(ALGO_ID, outputAssetId, algoReceived, slippageBps, network);
      if (hop2Quotes.length > 0) {
        const hop1 = hop1Quotes[0];
        const hop2 = hop2Quotes[0];
        const totalOutput = hop2.outputAmount;
        const totalFee = hop1.fee + hop2.fee;
        const totalImpact = 1 - (1 - hop1.priceImpact) * (1 - hop2.priceImpact);
        // min output with compound slippage
        const minOutput = Math.floor(totalOutput * (1 - slippageBps / 10000));

        bestMultiHop = {
          inputAssetId,
          outputAssetId,
          inputAmount,
          outputAmount: totalOutput,
          priceImpact: totalImpact,
          exchangeRate: totalOutput / inputAmount,
          fee: totalFee,
          minOutput,
          poolAddress: `${hop1.poolAddress}→${hop2.poolAddress}`,
          dex: `${hop1.dex}→${hop2.dex}`,
          isMultiHop: true,
          hops: [hop1, hop2],
        };
      }
    }
  }

  // Return the best option
  if (bestDirect && bestMultiHop) {
    // Direct wins if output is equal or better (less slippage, less fee)
    return bestDirect.outputAmount >= bestMultiHop.outputAmount
      ? { ...bestDirect, isMultiHop: false, hops: [bestDirect] }
      : bestMultiHop;
  }

  if (bestDirect) return { ...bestDirect, isMultiHop: false, hops: [bestDirect] };
  if (bestMultiHop) return bestMultiHop;
  return null;
}

/**
 * Execute a multi-hop swap: ASA_A → ALGO → ASA_B
 * Two sequential swaps in an atomic group (if supported) or sequentially.
 */
export async function executeMultiHopSwap(
  quote: MultiHopQuote,
  signer: SwapSigner,
  network: NetworkId,
): Promise<{ txId: string; hops: number }> {
  if (!quote.isMultiHop || quote.hops.length === 1) {
    // Direct swap
    const hop = quote.hops[0];
    const result = await executeSwapViaDex(hop.dexId ?? hop.dex, signer, hop.inputAssetId, hop.outputAssetId, hop.inputAmount, hop.minOutput, hop.poolAddress, network);
    return { txId: result.txId, hops: 1 };
  }

  // Multi-hop: execute hop 1, then hop 2
  const hop1 = quote.hops[0];
  const hop2 = quote.hops[1];

  const result1 = await executeSwapViaDex(hop1.dexId ?? hop1.dex, signer, hop1.inputAssetId, hop1.outputAssetId, hop1.inputAmount, hop1.minOutput, hop1.poolAddress, network);

  // Hop 2 uses the actual received ALGO from hop 1
  // In production this should read the actual balance, but for now use the quoted amount
  const result2 = await executeSwapViaDex(hop2.dexId ?? hop2.dex, signer, hop2.inputAssetId, hop2.outputAssetId, hop2.inputAmount, hop2.minOutput, hop2.poolAddress, network);

  return { txId: `${result1.txId}→${result2.txId}`, hops: 2 };
}

/** Execute swap through a specific DEX module */
export async function executeSwapViaDex(
  dexId: string,
  signer: SwapSigner,
  inputAssetId: number,
  outputAssetId: number,
  inputAmount: number,
  minOutputAmount: number,
  poolAddress: string,
  network: NetworkId,
): Promise<{ txId: string }> {
  const dex = DEX_MODULES.find(m => m.id === dexId);
  if (!dex) throw new Error(`DEX module not found: ${dexId}`);
  return dex.executeSwap(signer, inputAssetId, outputAssetId, inputAmount, minOutputAmount, poolAddress, network);
}
