import { describe, it, expect } from 'vitest';

import {
  registerMarketplaceProvider,
  getMarketplaceProvider,
  listMarketplaceProviders,
  findListingsAcrossProviders,
} from '../registry';
import type { MarketplaceProvider, MarketListing } from '../types';
// Importing the barrel self-registers the real providers.
import '../index';

function fakeProvider(over: Partial<MarketplaceProvider> & { id: string }): MarketplaceProvider {
  return {
    displayName: over.id,
    description: '',
    kinds: ['nfd-name'],
    settlement: 'in-wallet',
    supports: () => true,
    findListing: async () => null,
    buy: async () => ({ settled: false }),
    ...over,
  };
}

describe('marketplace provider registry', () => {
  it('registers the three built-in providers', () => {
    expect(getMarketplaceProvider('nfd')).toBeDefined();
    expect(getMarketplaceProvider('bankon-marketspace')).toBeDefined();
    expect(getMarketplaceProvider('agenticplace')).toBeDefined();
  });

  it('filters providers by asset kind', () => {
    const nameProviders = listMarketplaceProviders({ kind: 'nfd-name' });
    expect(nameProviders.some((p) => p.id === 'nfd')).toBe(true);
    expect(nameProviders.some((p) => p.id === 'agenticplace')).toBe(false);

    const agentProviders = listMarketplaceProviders({ kind: 'agent-nft' });
    expect(agentProviders.some((p) => p.id === 'agenticplace')).toBe(true);
    expect(agentProviders.some((p) => p.id === 'nfd')).toBe(false);
  });

  it('filters providers by network support', () => {
    // AgenticPlace is mainnet-only.
    expect(listMarketplaceProviders({ network: 'testnet' }).some((p) => p.id === 'agenticplace'))
      .toBe(false);
    expect(listMarketplaceProviders({ network: 'mainnet' }).some((p) => p.id === 'agenticplace'))
      .toBe(true);
  });

  it('a new provider plugs in without touching existing code', () => {
    registerMarketplaceProvider(fakeProvider({ id: 'test-plugin', kinds: ['algorand-asa'] }));
    expect(getMarketplaceProvider('test-plugin')).toBeDefined();
    expect(listMarketplaceProviders({ kind: 'algorand-asa' }).map((p) => p.id))
      .toContain('test-plugin');
  });

  it('isolates a failing provider — others still return listings', async () => {
    // Use a kind no built-in provider claims, so the query is network-free
    // and deterministic — only the two fakes below answer.
    const good: MarketListing = {
      providerId: 'good', ref: 'x', title: 'x', kind: 'algorand-asa',
      network: 'mainnet', status: 'for-sale',
    };
    registerMarketplaceProvider(fakeProvider({
      id: 'good-one', kinds: ['algorand-asa'], findListing: async () => good,
    }));
    registerMarketplaceProvider(fakeProvider({
      id: 'broken-one', kinds: ['algorand-asa'],
      findListing: async () => { throw new Error('marketplace down'); },
    }));
    const found = await findListingsAcrossProviders('x', 'mainnet', 'algorand-asa');
    expect(found.some((l) => l.providerId === 'good')).toBe(true);
    expect(found.every((l) => l.providerId !== 'broken-one')).toBe(true);
  });
});
