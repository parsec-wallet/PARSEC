// Marketplace provider registry — the single source of truth for which
// marketplaces PARSEC can trade through. Providers self-register at module
// load (see the side-effect imports in ./index.ts). Consumers read them
// generically; nothing here knows about NFD, BANKON or AgenticPlace.

import type { NetworkId } from '../../../types/wallet';
import type { MarketAssetKind, MarketListing, MarketplaceProvider } from './types';

const REGISTRY = new Map<string, MarketplaceProvider>();

export function registerMarketplaceProvider(provider: MarketplaceProvider): void {
  REGISTRY.set(provider.id, provider);
}

export function getMarketplaceProvider(id: string): MarketplaceProvider | undefined {
  return REGISTRY.get(id);
}

interface ProviderFilter {
  kind?: MarketAssetKind;
  network?: NetworkId;
}

/** Registered providers, optionally narrowed to an asset kind / network. */
export function listMarketplaceProviders(filter: ProviderFilter = {}): MarketplaceProvider[] {
  return Array.from(REGISTRY.values()).filter((p) => {
    if (filter.kind && !p.kinds.includes(filter.kind)) return false;
    if (filter.network && !p.supports(filter.network)) return false;
    return true;
  });
}

/**
 * Ask every provider that handles `kind` on `network` whether it has a
 * listing for `ref`. Provider failures are isolated with `allSettled` — one
 * slow or broken marketplace never blocks or fails the others.
 */
export async function findListingsAcrossProviders(
  ref: string,
  network: NetworkId,
  kind?: MarketAssetKind,
): Promise<MarketListing[]> {
  const providers = listMarketplaceProviders({ kind, network });
  const settled = await Promise.allSettled(
    providers.map((p) => p.findListing(ref, network)),
  );
  const listings: MarketListing[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) listings.push(result.value);
  }
  return listings;
}
