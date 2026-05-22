// Marketplace provider barrel. Importing this module triggers each
// provider's self-registration via the side effects in its file. To add a
// marketplace, drop a new provider file here and import it — nothing else
// in the wallet changes.

import './nfd-provider';
import './bankon-provider';
import './agenticplace-provider';

export {
  registerMarketplaceProvider,
  getMarketplaceProvider,
  listMarketplaceProviders,
  findListingsAcrossProviders,
} from './registry';
export type {
  MarketAssetKind,
  MarketBuyArgs,
  MarketBuyResult,
  MarketListing,
  MarketQuote,
  MarketplaceProvider,
  SettlementMode,
} from './types';
