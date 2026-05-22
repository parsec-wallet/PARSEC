// AgenticPlace provider — the living ERC-8004 agent registry at
// agenticplace.pythai.net. Agents are minted as Algorand NFTs and indexed
// across many chains.
//
// AgenticPlace runs its own hosted mint/verify flow, so this provider is
// `external`: discovery happens through its public read API, and a purchase
// hands off to the AgenticPlace web app. It is registered the same way the
// in-wallet providers are — proof that the marketplace layer is open to
// third-party services without touching Parsec's core.

import type { NetworkId } from '../../../types/wallet';
import { registerMarketplaceProvider } from './registry';
import type { MarketBuyResult, MarketListing, MarketplaceProvider } from './types';

const AGENTICPLACE_SITE = 'https://agenticplace.pythai.net';
const AGENTS_EXPORT = `${AGENTICPLACE_SITE}/api/export?table=agents&format=json`;

/** AgenticPlace's agent export rows are loosely shaped — read defensively. */
interface AgentRow {
  id?: string | number;
  name?: string;
  chain?: string;
  network?: string;
  address?: string;
  asset_id?: string | number;
  owner?: string;
}

function rowToListing(row: AgentRow, network: NetworkId): MarketListing {
  const ref = String(row.id ?? row.asset_id ?? row.name ?? '');
  return {
    providerId: 'agenticplace',
    ref,
    title: row.name ?? ref,
    kind: 'agent-nft',
    network,
    status: 'for-sale',
    seller: row.owner ?? row.address,
    url: `${AGENTICPLACE_SITE}/agent/${encodeURIComponent(ref)}`,
    meta: { chain: row.chain ?? row.network },
  };
}

export const agenticplaceProvider: MarketplaceProvider = {
  id: 'agenticplace',
  displayName: 'AgenticPlace',
  description: 'ERC-8004 agent registry — mint and verify agent NFTs across chains.',
  kinds: ['agent-nft'],
  settlement: 'external',
  // AgenticPlace mints agent NFTs on Algorand mainnet.
  supports: (network) => network === 'mainnet',

  async findListing(ref, network) {
    const all = await this.browse!(network, 500);
    return all.find((l) => l.ref === ref || l.title === ref) ?? null;
  },

  async browse(network, limit = 20) {
    const res = await fetch(AGENTS_EXPORT);
    if (!res.ok) throw new Error(`AgenticPlace export failed (HTTP ${res.status})`);
    const body = (await res.json()) as unknown;
    const rows: AgentRow[] = Array.isArray(body)
      ? (body as AgentRow[])
      : ((body as { agents?: AgentRow[]; data?: AgentRow[] }).agents
        ?? (body as { data?: AgentRow[] }).data
        ?? []);
    return rows.slice(0, limit).map((row) => rowToListing(row, network));
  },

  buy({ listing }): Promise<MarketBuyResult> {
    return Promise.resolve({
      settled: false,
      externalUrl: listing.url ?? AGENTICPLACE_SITE,
    });
  },
};

registerMarketplaceProvider(agenticplaceProvider);
