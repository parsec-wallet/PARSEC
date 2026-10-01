// SpinTrade — DEX Interface Types
// Every DEX module implements this interface.
// SpinTrade aggregates quotes from all enabled DEX sources.
// Participant chooses the best price and path.

import type algosdk from 'algosdk';
import type { NetworkId } from '../../types/wallet';

/** Signs for the swapping account — the PARSEC Keycore on desktop. Never a key. */
export interface SwapSigner {
  address: string;
  sign: algosdk.TransactionSigner;
}

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
  dex: string; // which DEX provided this quote (display name)
  /** The module that executes this quote (DexModule.id). */
  dexId?: string;
}

export interface DexAsset {
  assetId: number;
  unitName: string;
  name: string;
  decimals: number;
  // Pool context — what the participant needs to see
  poolReserveThis?: number;   // reserve of THIS asset in the pool
  poolReserveOther?: number;  // reserve of the OTHER asset (the input asset)
  poolPrice?: number;         // price ratio: 1 input = X of this asset
  poolLiquidity?: string;     // human-readable liquidity description
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
    signer: SwapSigner,
    inputAssetId: number,
    outputAssetId: number,
    inputAmount: number,
    minOutputAmount: number,
    poolAddress: string,
    network: NetworkId,
  ): Promise<{ txId: string }>;
}
