// NFD domain types used across the Parsec wrapper layer.
// Re-export SDK types where possible; extend with Parsec-specific fields.

export type {
  Nfd,
  NfdImageResult,
  ResolveOptions,
  ReverseLookupOptions,
  SearchOptions,
  SearchResponse,
  NfdMintQuote,
  NfdMintQuoteParams,
  NfdMintParams,
  NfdPurchaseQuote,
} from '@txnlab/nfd-sdk';

/** Micro-ALGO amount. Always bigint to match SDK. */
export type MicroAlgos = bigint;

/**
 * Full breakdown shown to the user in the NFDominter review screen.
 * basePrice + carryCost + extraFee come from the NFD Registry (not us).
 * bankonFee is Parsec's tip for hosting NFDominter.
 */
export interface NfdMintCostBreakdown {
  nfdName: string;
  years: number;
  isSegment: boolean;
  basePrice: MicroAlgos;
  carryCost: MicroAlgos;
  extraFee: MicroAlgos;
  bankonFee: MicroAlgos;
  /** basePrice + carryCost + extraFee + bankonFee */
  totalMicroAlgos: MicroAlgos;
}

/** Stages the UI renders while a mint is in flight. */
export type MintStage =
  | 'idle'
  | 'validating'
  | 'checking-availability'
  | 'quoting'
  | 'paying-bankon-fee'
  | 'paying-service-fee'
  | 'awaiting-signature'
  | 'submitting'
  | 'confirmed'
  | 'error';

export interface MintProgress {
  stage: MintStage;
  message?: string;
  /** Set once the mint transaction confirms. */
  appId?: bigint;
  /** Round the mint confirmed in. */
  round?: bigint;
  /** Populated when stage === 'error'. */
  error?: string;
}
