// PARSEC Wallet — the verified Algorand assets: offered for one-click opt-in and the authority
// for what "verified" means anywhere in the wallet.
//
// The data is `asset-whitelist.json`. Every entry is pinned by id, creator, unit, on-chain name,
// decimals and the issuer's freeze/clawback rights, with the sources it was confirmed from;
// `scripts/asa-whitelist-check.mjs` re-derives each one from the indexer (and Pera's verification
// tier on mainnet) and the test suite holds the list to its committed snapshot. The creator is
// part of the entry so a match means the real asset, not one that copied its name.
//
// Several real assets can share a ticker — Circle's USDC and Wormhole's bridged USDC are both
// "USDC" — so the list tells them apart by issuer, and an asset is verified only by its id.
// Anything not on the list is unverified, and an unlisted asset borrowing a listed unit or name
// is called out as not the listed one.

import type { NetworkId } from '../../types/wallet';
import data from './asset-whitelist.json';
import { classifyAsset } from './asset-classify';

export type AssetGroup = 'Stablecoins' | 'Bitcoin & Ether' | 'Algorand ecosystem';

export interface StandardAsset {
  assetId: number;
  unitName: string;
  /** The asset's on-chain name, exactly. */
  name: string;
  /** How PARSEC names it where the on-chain name is ambiguous ("USD Coin (Wormhole)"). */
  label?: string;
  decimals: number;
  issuer: string;
  creator: string;
  group: AssetGroup;
  /** The issuer can freeze holdings (regulated stablecoins do). */
  freeze: boolean;
  /** The issuer can take tokens back. */
  clawback: boolean;
  /** Where the entry was confirmed (the issuer's own page first). */
  sources: string[];
}

/** The date the list was last checked against the chain. */
export const WHITELIST_CHECKED: string = data.checked;

const MAINNET = data.mainnet as StandardAsset[];
const TESTNET = data.testnet as StandardAsset[];

/** The name to show for a listed asset. */
export function displayName(a: StandardAsset): string {
  return a.label ?? a.name;
}

export function standardAssets(network: NetworkId): StandardAsset[] {
  return network === 'mainnet' ? MAINNET : network === 'testnet' ? TESTNET : [];
}

/** The listed asset with this id on this network, if any. */
export function standardAsset(network: NetworkId, assetId: number): StandardAsset | undefined {
  return standardAssets(network).find((a) => a.assetId === assetId);
}

/**
 * A listed asset whose unit or name this one borrows under a different id — the shape of a
 * lookalike ("USDC" that is not Circle's USDC), including look-alike letters, invisible
 * characters and spacing (see `asset-classify.ts`). Undefined when it is a listed asset itself
 * or borrows nothing.
 */
export function lookalikeOf(network: NetworkId, assetId: number, unitName: string, name: string): StandardAsset | undefined {
  const c = classifyAsset(network, { assetId, unitName, name });
  return c.kind === 'lookalike' ? c.of : undefined;
}

/**
 * Verified assets matching a query by id, ticker, name or issuer — answered
 * locally and instantly, so a search always shows the verified asset first,
 * whatever the indexer returns.
 */
export function searchStandard(network: NetworkId, query: string): StandardAsset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return standardAssets(network).filter((a) => String(a.assetId) === q
    || a.unitName.toLowerCase().includes(q)
    || a.name.toLowerCase().includes(q)
    || (a.label ?? '').toLowerCase().includes(q)
    || a.issuer.toLowerCase().includes(q));
}
