// Public surface of PARSEC's NFD wrapper. One import path for views.

export { getNfdClient, resetNfdClients } from './client';
export { getBankonFeeAddress, BANKON_FEE_CONFIG, bankonFeeFor, isFeeConfigured } from './fees';
export { makeParsecSigner } from './signer';
export {
  resolveName,
  resolveAddress,
  lookupNfd,
  invalidateNfdCaches,
  displayName,
} from './resolve';
export { searchNfds, searchByOwner, searchForSale } from './search';
export { getMintQuoteWithBankonFee, mintNfdWithFee } from './mint';
export { offerNfdForTransfer, type NfdTransferArgs } from './transfer';
export {
  setSegmentLock,
  isSegmentMintingUnlocked,
  USD_TO_SEGMENT_PRICE,
  type SegmentLockArgs,
} from './segments';
export {
  linkAddress,
  unlinkAddress,
  setMetadata,
  setPrimaryAddress,
  setPrimaryNfd,
} from './manage';
export {
  canMintSegment,
  classifyTier,
  extractParentName,
  isSegmentName,
  isValidName,
  nameError,
  normalizeName,
  rootLabel,
  rootLength,
} from './validate';
export type {
  MicroAlgos,
  MintProgress,
  MintStage,
  Nfd,
  NfdImageResult,
  NfdMintCostBreakdown,
  NfdMintParams,
  NfdMintQuote,
  NfdMintQuoteParams,
  NfdPurchaseQuote,
  ResolveOptions,
  ReverseLookupOptions,
  SearchOptions,
  SearchResponse,
} from './types';
export type { NfdTier } from './validate';
