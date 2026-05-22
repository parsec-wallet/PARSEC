// Extensible marketplace provider layer.
//
// Parsec is not bound to a single marketplace. A *provider* is any service
// that can surface listings and complete a purchase: NFD's native
// buy-it-now, the BANKON Marketspace Registry, AgenticPlace, or a
// third-party plugin shipped as an extension. Providers self-register into
// the registry; every consumer (the NFDominter "this name is for sale"
// panel, a future unified marketplace browser) reads them generically
// through this interface — adding a marketplace never edits consumer code.

import type { NetworkId } from '../../../types/wallet';

/** What an item being traded is. Lets a consumer pick relevant providers. */
export type MarketAssetKind =
  | 'nfd-name' // an .algo NFD
  | 'bankon-name' // a BANKON / ArNS namespace name
  | 'algorand-asa' // an Algorand Standard Asset
  | 'agent-nft'; // an ERC-8004 / AgenticPlace agent NFT

/** How a buyer completes a purchase through a provider. */
export type SettlementMode =
  | 'in-wallet' // Parsec builds, signs and submits the purchase itself
  | 'redirect' // Parsec routes to another in-wallet view to finish
  | 'external'; // hands off to a hosted marketplace (opens a URL)

/**
 * A normalized listing — provider-agnostic. Monetary amounts are in the
 * smallest unit of `priceCurrency` (microAlgos for ALGO, mARIO for ARIO).
 */
export interface MarketListing {
  /** id of the provider that surfaced this listing. */
  providerId: string;
  /** Stable reference within the provider (NFD name, BMR listing id, ASA id). */
  ref: string;
  title: string;
  kind: MarketAssetKind;
  network: NetworkId;
  status: 'for-sale' | 'auction' | 'reserved' | 'sold' | 'unavailable';
  /** Price in the smallest unit; omitted when only known at checkout. */
  priceMinor?: bigint;
  priceCurrency?: string;
  seller?: string;
  /** Hosted page for this listing, when the provider has one. */
  url?: string;
  /** Provider-specific extras consumers may surface but need not understand. */
  meta?: Record<string, unknown>;
}

/** A firm, buyer-specific quote. */
export interface MarketQuote {
  listing: MarketListing;
  buyer: string;
  totalMinor: bigint;
  currency: string;
  canBuy: boolean;
  /** Populated when canBuy is false — why the buy is blocked. */
  reason?: string;
}

export interface MarketBuyArgs {
  listing: MarketListing;
  buyer: string;
  /** Unlocked vault passphrase — only used by in-wallet providers. */
  passphrase: string;
}

export interface MarketBuyResult {
  /** True when the purchase settled on-chain from within Parsec. */
  settled: boolean;
  txid?: string;
  /** redirect providers: an in-wallet view name to navigate to. */
  route?: string;
  /** external providers: the page the user completes the buy on. */
  externalUrl?: string;
}

/**
 * The contract every marketplace implements. A new marketplace is added by
 * writing one of these and calling `registerMarketplaceProvider` — no
 * consumer code changes.
 */
export interface MarketplaceProvider {
  /** Stable id, e.g. 'nfd', 'bankon-marketspace', 'agenticplace'. */
  id: string;
  displayName: string;
  /** One-line description for the marketplace picker. */
  description: string;
  /** Asset kinds this provider deals in. */
  kinds: MarketAssetKind[];
  settlement: SettlementMode;
  /** Networks the provider operates on. */
  supports(network: NetworkId): boolean;
  /** Resolve an exact reference (a name, an asset id) to a listing, or null. */
  findListing(ref: string, network: NetworkId): Promise<MarketListing | null>;
  /** Optional discovery — recent / featured listings. */
  browse?(network: NetworkId, limit?: number): Promise<MarketListing[]>;
  /** Firm quote. Required for in-wallet settlement; optional otherwise. */
  quote?(listing: MarketListing, buyer: string): Promise<MarketQuote>;
  /** Complete the purchase per the provider's `settlement` mode. */
  buy(args: MarketBuyArgs): Promise<MarketBuyResult>;
}
