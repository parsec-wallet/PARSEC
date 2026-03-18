// SpinTrade swap engine has moved to modular DEX architecture.
// Re-exports for backward compatibility.

export { fetchAllPairs as fetchPoolsForAsset } from '../dex/spintrade';
export { fetchAllQuotes as getSwapQuote } from '../dex/spintrade';
export { executeSwapViaDex as executeSwap } from '../dex/spintrade';
export type { DexQuote as SwapQuote, DexAsset as SwapableAsset } from '../dex/types';
