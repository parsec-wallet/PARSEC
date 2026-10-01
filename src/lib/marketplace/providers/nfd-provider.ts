// NFD marketplace provider — native buy-it-now for .algo names.
//
// NFD instance contracts expose `offerForSale` / `purchase` ABI methods, so
// a listed name can be bought and settled entirely on-chain from inside
// PARSEC. The SDK's `getPurchaseQuote` / `buy` wrap that; this provider
// adapts them to the generic MarketplaceProvider contract.

import type { NetworkId } from '../../../types/wallet';
import { getNfdClient, makeParsecSigner } from '../../nfd';
import { registerMarketplaceProvider } from './registry';
import type {
  MarketBuyArgs,
  MarketBuyResult,
  MarketQuote,
  MarketplaceProvider,
} from './types';

const NFD_API: Partial<Record<NetworkId, string>> = {
  mainnet: 'https://api.nf.domains',
  testnet: 'https://api.testnet.nf.domains',
};
const NFD_SITE = 'https://app.nf.domains';

/** A no-op signer: getPurchaseQuote only reads the buyer address from it. */
function quoteOnlySigner(): () => Promise<Uint8Array[]> {
  return () => Promise.reject(new Error('quote-only signer must not sign'));
}

interface NfdSaleRecord {
  state?: string;
  owner?: string;
  saleType?: string;
  sellAmount?: number;
}

export const nfdMarketplaceProvider: MarketplaceProvider = {
  id: 'nfd',
  displayName: 'NFD Marketplace',
  description: 'Native buy-it-now for .algo NFD names, settled on-chain inside PARSEC.',
  kinds: ['nfd-name'],
  settlement: 'in-wallet',
  supports: (network) => network === 'mainnet' || network === 'testnet',

  async findListing(ref, network) {
    const base = NFD_API[network];
    if (!base) return null;
    const res = await fetch(`${base}/nfd/${encodeURIComponent(ref)}?view=full`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`NFD lookup failed (HTTP ${res.status})`);
    const nfd = (await res.json()) as NfdSaleRecord;

    const state = (nfd.state ?? '').toLowerCase();
    // Only `forSale`/`reserved` names can be purchased; `owned` ones are not
    // for sale even if the owner set a saleType, and `available` ones are
    // mintable, not buyable.
    if (state !== 'forsale' && state !== 'reserved') return null;

    const sell = typeof nfd.sellAmount === 'number' && nfd.sellAmount > 0
      ? BigInt(Math.round(nfd.sellAmount))
      : undefined;
    return {
      providerId: 'nfd',
      ref,
      title: ref,
      kind: 'nfd-name',
      network,
      status: state === 'forsale' ? 'for-sale' : 'reserved',
      priceMinor: sell,
      priceCurrency: sell !== undefined ? 'ALGO' : undefined,
      seller: nfd.owner,
      url: `${NFD_SITE}/name/${ref}`,
      meta: { saleType: nfd.saleType },
    };
  },

  async quote(listing, buyer): Promise<MarketQuote> {
    const client = getNfdClient(listing.network).setSigner(buyer, quoteOnlySigner());
    const q = (await client.getPurchaseQuote(listing.ref)) as {
      price?: number | bigint;
      canBuy?: boolean;
      authorized?: boolean;
      authorizationError?: string;
    };
    const canBuy = Boolean(q.canBuy && q.authorized);
    return {
      listing,
      buyer,
      totalMinor: q.price !== undefined ? BigInt(q.price) : 0n,
      currency: 'ALGO',
      canBuy,
      reason: canBuy ? undefined : (q.authorizationError ?? 'Not available for purchase.'),
    };
  },

  async buy({ listing, buyer, passphrase }: MarketBuyArgs): Promise<MarketBuyResult> {
    const client = getNfdClient(listing.network).setSigner(
      buyer,
      makeParsecSigner(buyer, passphrase),
    );
    // The SDK builds the payment + `purchase` app call, signs and submits.
    const bought = (await client.buy(listing.ref)) as { appID?: number | bigint };
    return { settled: true, txid: bought.appID ? String(bought.appID) : undefined };
  },
};

registerMarketplaceProvider(nfdMarketplaceProvider);
