// PARSEC Wallet — Algorand assets in the command palette (Ctrl/Cmd-K).
//
// Algorand only, and labelled so: an ASA id means nothing on any other chain, so these results
// never mix with EVM chains or tokens (those are the RAGEbar's, in the Matrix). Results come
// from PARSEC's verified list (instant, local) and then the Algorand indexer for the active
// network, each marked verified / lookalike / unverified by `classifyAsset`. Choosing one opens
// ADD ASSETS with that asset first, where adding (or removing) is signed in the Keycore.

import { store } from '../store';
import { searchStandard, displayName } from '../algorand/asset-whitelist';
import { classifyAsset, type AssetClass } from '../algorand/asset-classify';
import { searchAssets } from '../algorand/assets';
import type { NetworkId } from '../../types/wallet';

export interface AssetHit {
  assetId: number;
  unitName: string;
  name: string;
  network: NetworkId;
  cls: AssetClass;
}

/** The Algorand network the palette searches, or null when there is none to search. */
export function assetNetwork(): NetworkId | null {
  const s = store.get();
  const n = s.settings.network as NetworkId;
  return s.accounts.length && (n === 'mainnet' || n === 'testnet') ? n : null;
}

/** Worth searching assets for: an ASA id, or at least two characters. */
export function isAssetQuery(q: string): boolean {
  const t = q.trim();
  return /^\d{1,20}$/.test(t) || t.length >= 2;
}

/** Verified matches, at once and without the network. */
export function instantAssetHits(q: string, network: NetworkId): AssetHit[] {
  return searchStandard(network, q).slice(0, 6).map((a) => ({
    assetId: a.assetId, unitName: a.unitName, name: displayName(a), network,
    cls: { kind: 'verified', asset: a },
  }));
}

/** The indexer's matches, classified, minus those already shown. Verified first, then lookalikes. */
export async function indexerAssetHits(q: string, network: NetworkId, shown: Set<number>): Promise<AssetHit[]> {
  const found = await searchAssets(q.trim(), network);
  const rank = { verified: 0, lookalike: 1, unverified: 2 } as const;
  return found
    .filter((r) => !shown.has(r.assetId))
    .map((r) => ({ assetId: r.assetId, unitName: r.unitName, name: r.name, network, cls: classifyAsset(network, r) }))
    .sort((a, b) => rank[a.cls.kind] - rank[b.cls.kind])
    .slice(0, 8);
}

/** One line describing what a hit is, in plain words. */
export function describeHit(h: AssetHit): { badge: string; tone: 'ok' | 'danger' | 'muted'; detail: string } {
  const where = `Algorand ${h.network} · ASA ${h.assetId}`;
  switch (h.cls.kind) {
    case 'verified':
      return { badge: `✓ Verified · ${h.cls.asset.issuer}`, tone: 'ok', detail: where };
    case 'lookalike':
      return {
        badge: `⚠ Not ${h.cls.of.unitName}`, tone: 'danger',
        detail: `${where} — borrows the ${h.cls.by} of ${displayName(h.cls.of)} (ASA ${h.cls.of.assetId})`,
      };
    default:
      return { badge: 'Unverified', tone: 'muted', detail: where };
  }
}

// The asset ADD ASSETS should open on. Set by the palette, read once by the view.
let focus: number | null = null;
export function setAssetFocus(assetId: number): void { focus = assetId; }
export function takeAssetFocus(): number | null { const f = focus; focus = null; return f; }
