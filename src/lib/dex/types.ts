// SpinTrade — DEX Interface Types
// Every DEX module implements this interface.
// SpinTrade aggregates quotes from all enabled DEX sources.
// Participant chooses the best price and path.

import type { NetworkId } from '../../types/wallet';

export interface DexQuote {
  inputAssetId: number;
  outputAssetId: number;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  exchangeRate: number;
  fee: number;
  minOutput: number;
  poolAddress: string;
  dex: string; // which DEX provided this quote
}

export interface DexAsset {
  assetId: number;
  unitName: string;
  name: string;
  decimals: number;
}

export interface DexModule {
  id: string;
  name: string;
  enabled: boolean;

  /** Fetch assets available to swap against a given input asset */
  fetchPairsForAsset(assetId: number, network: NetworkId): Promise<DexAsset[]>;

  /** Get a quote for a swap */
  getQuote(
    inputAssetId: number,
    outputAssetId: number,
    inputAmount: number,
    slippageBps: number,
    network: NetworkId,
  ): Promise<DexQuote | null>;

  /** Execute the swap on-chain */
  executeSwap(
    mnemonic: string,
    inputAssetId: number,
    outputAssetId: number,
    inputAmount: number,
    minOutputAmount: number,
    poolAddress: string,
    network: NetworkId,
  ): Promise<{ txId: string }>;
}
