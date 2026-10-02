// SPINTRADE — which asset is which, by id, against PARSEC's verified list.
//
// Anyone can mint an asset called "USDC". In every pair picker, quote, route and confirmation
// SPINTRADE names an asset by its ticker AND its ASA id, and marks it verified only when
// `classifyAsset` says so (its id is on the verified list). Unverified assets are shown as such,
// lookalikes are called out, and a swap into or out of either needs an explicit confirmation.
// ALGO (asset 0) is the chain's native currency and needs no list.

import type { NetworkId } from '../../types/wallet';
import { classifyAsset, type AssetClass } from '../algorand/asset-classify';
import { displayName } from '../algorand/asset-whitelist';

export interface SwapAssetFacts {
  assetId: number;
  unitName: string;
  name: string;
}

export type SwapStatus = { kind: 'native' } | AssetClass;

export function swapStatus(network: NetworkId, a: SwapAssetFacts): SwapStatus {
  return a.assetId === 0 ? { kind: 'native' } : classifyAsset(network, a);
}

/** Safe to swap without a second look: native ALGO or a verified asset. */
export function isTrusted(s: SwapStatus): boolean {
  return s.kind === 'native' || s.kind === 'verified';
}

/** "USDC (ASA 31566704)" — the ticker never stands alone. */
export function assetLabel(a: SwapAssetFacts): string {
  if (a.assetId === 0) return 'ALGO';
  return `${a.unitName || a.name || 'Unnamed'} (ASA ${a.assetId})`;
}

/** A short badge for the status. */
export function statusBadge(s: SwapStatus): { text: string; tone: 'ok' | 'warn' | 'danger' } {
  switch (s.kind) {
    case 'native': return { text: 'native', tone: 'ok' };
    case 'verified': return { text: `✓ verified · ${s.asset.issuer}`, tone: 'ok' };
    case 'lookalike': return { text: `⚠ not ${s.of.unitName}`, tone: 'danger' };
    default: return { text: 'unverified', tone: 'warn' };
  }
}

/** What the person must acknowledge before swapping into or out of `a`, or null if nothing. */
export function confirmationFor(s: SwapStatus, a: SwapAssetFacts): string | null {
  if (s.kind === 'lookalike') {
    return `${assetLabel(a)} is NOT ${displayName(s.of)} (ASA ${s.of.assetId}, ${s.of.issuer}) — it only borrows its ${s.by}. I want this asset anyway.`;
  }
  if (s.kind === 'unverified') {
    return `${assetLabel(a)} is not on PARSEC's verified list. I have checked its id with its issuer.`;
  }
  return null;
}

/** Ordering for the pool list: USDC first, then verified, unverified, lookalikes. */
export function poolRank(s: SwapStatus, assetId: number, usdcId: number | null): number {
  if (assetId === usdcId) return 0;
  return { native: 1, verified: 1, unverified: 2, lookalike: 3 }[s.kind];
}
