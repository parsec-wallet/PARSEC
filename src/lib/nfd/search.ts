// Thin pass-through over the SDK's search API. Most consumers call these
// once per tab render, so we don't cache — the SDK does its own HTTP
// caching and the search surface is large.

import type { NetworkId } from '../../types/wallet';
import { getNfdClient } from './client';
import type { SearchOptions, SearchResponse } from './types';

/** Generic search. */
export function searchNfds(
  network: NetworkId,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  return getNfdClient(network).api.search(options);
}

/** NFDs owned by a particular address. */
export function searchByOwner(
  network: NetworkId,
  address: string,
  options: Omit<SearchOptions, 'owner' | 'state'> = {},
): Promise<SearchResponse> {
  return getNfdClient(network).searchByOwner(address, options);
}

/** Currently-for-sale NFDs (both buy-it-now and auctions). */
export function searchForSale(
  network: NetworkId,
  options: Omit<SearchOptions, 'state'> = {},
): Promise<SearchResponse> {
  return getNfdClient(network).searchForSale(options);
}
