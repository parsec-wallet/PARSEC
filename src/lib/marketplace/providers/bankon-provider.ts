// BANKON Marketspace provider — the sovereign, AO-hosted name marketplace
// (BANKON Marketspace Registry). Trades BANKON and ArNS namespace names.
//
// A BMR purchase is a multi-step escrow flow (make-offer → accept → settle),
// so this provider settles by `redirect`: it routes into the in-wallet
// market-hub where that flow lives, rather than one-click signing.

import type { NetworkId } from '../../../types/wallet';
import { isBmrConfigured } from '../process-id';
import { getListing, listListings, type Listing } from '../client';
import { registerMarketplaceProvider } from './registry';
import type { MarketBuyResult, MarketListing, MarketplaceProvider } from './types';

const WEB_MIRROR = 'https://agenticplace.pythai.net/marketspace';

function toMarketListing(l: Listing, network: NetworkId): MarketListing {
  return {
    providerId: 'bankon-marketspace',
    ref: l.id,
    title: l.name,
    kind: 'bankon-name',
    network,
    status: l.isAuction ? 'auction' : l.status === 'open' ? 'for-sale' : 'unavailable',
    priceMinor: (() => {
      try { return BigInt(l.askPrice); } catch { return undefined; }
    })(),
    priceCurrency: l.currency,
    seller: l.seller,
    url: WEB_MIRROR,
    meta: { namespace: l.namespace, listingId: l.id, isAuction: l.isAuction },
  };
}

export const bankonMarketspaceProvider: MarketplaceProvider = {
  id: 'bankon-marketspace',
  displayName: 'BANKON Marketspace',
  description: 'Sovereign AO-hosted marketplace for BANKON and ArNS names.',
  kinds: ['bankon-name'],
  settlement: 'redirect',
  // The BMR is an AO process, not bound to an Algorand network.
  supports: () => true,

  async findListing(ref, network) {
    if (!isBmrConfigured()) return null;
    try {
      // `ref` may be a listing id or a name — accept either.
      const byId = await getListing(ref).catch(() => null);
      if (byId) return toMarketListing(byId, network);
      const open = await listListings({ status: 'open' });
      const match = open.find((l) => l.name === ref || l.id === ref);
      return match ? toMarketListing(match, network) : null;
    } catch {
      return null;
    }
  },

  async browse(network, limit = 20) {
    if (!isBmrConfigured()) return [];
    const open = await listListings({ status: 'open' });
    return open.slice(0, limit).map((l) => toMarketListing(l, network));
  },

  buy(): Promise<MarketBuyResult> {
    // The escrow/offer flow lives in the market-hub view.
    return Promise.resolve({ settled: false, route: 'market-hub' });
  },
};

registerMarketplaceProvider(bankonMarketspaceProvider);
