// Public surface of Parsec's NFD wrapper. One import path for views.

export { getNfdClient, resetNfdClients } from './client';
export { BANKON_FEE_ADDRESS, BANKON_FEE_CONFIG, bankonFeeFor, isFeeConfigured } from './fees';
export { makeParsecSigner } from './signer';
export {
  resolveName,
  resolveAddress,
  invalidateNfdCaches,
  displayName,
} from './resolve';
export { searchNfds, searchByOwner, searchForSale } from './search';
export { getMintQuoteWithBankonFee, mintNfdWithFee } from './mint';
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
