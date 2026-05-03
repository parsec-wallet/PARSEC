// Resolve and normalize NFT metadata across the three common Algorand ARCs:
// ARC-3 (immutable JSON at params.url), ARC-19 (template-IPFS via reserve
// address), and ARC-69 (metadata in the asset-config-txn note).
//
// Pattern adapted from AlgoNode/algostack's Medias module — single normalized
// shape regardless of source ARC. All fetches go through query-cache so a
// dashboard with N NFTs makes at most N indexer/IPFS calls per session window.

import type { NetworkId } from '../../types/wallet';
import { getIndexerClient } from './client';
import { rateLimitedQuery } from './query-cache';
import { fetchIpfs, parseIpfsUri } from './ipfs-gateway';
import { isArc19Template, resolveArc19 } from './nft-arc19';

export type ArcVariant = 'arc-3' | 'arc-19' | 'arc-69' | 'unknown';

export interface NftMetadata {
  name?: string;
  description?: string;
  image?: string;       // ipfs:// or https:// (resolved through ipfs-gateway when displaying)
  mimeType?: string;
  traits: Record<string, string | number>;
  arcVariant: ArcVariant;
}

export interface NftSourceParams {
  url?: string;
  reserve?: string;
  name?: string;
  unitName?: string;
}

/**
 * Resolve NFT metadata for an ASA. Detects the ARC variant from the asset
 * params and dispatches accordingly. Returns null if the asset isn't an NFT
 * or no metadata can be loaded.
 */
export async function resolveNftMetadata(
  assetId: number,
  params: NftSourceParams,
  network: NetworkId,
): Promise<NftMetadata | null> {
  if (!params.url && !isArc69Candidate(params)) return null;

  const variant = detectArcVariant(params);
  // ARC-69 is mutable (last config txn wins) → shorter TTL.
  const ttl = variant === 'arc-69' ? 600_000 : 3_600_000;
  const key = `nft:${assetId}@${network}:${variant}`;

  return rateLimitedQuery(`indexer:${network}`, key, ttl, async () => {
    try {
      switch (variant) {
        case 'arc-19':
          return await resolveArc19Metadata(params);
        case 'arc-3':
          return await resolveArc3Metadata(params);
        case 'arc-69':
          return await resolveArc69Metadata(assetId, network);
        default:
          return null;
      }
    } catch {
      return null;
    }
  });
}

function detectArcVariant(params: NftSourceParams): ArcVariant {
  const url = params.url || '';
  if (isArc19Template(url)) return 'arc-19';
  if (url && (url.startsWith('ipfs://') || url.startsWith('https://') || url.startsWith('http://'))) return 'arc-3';
  if (isArc69Candidate(params)) return 'arc-69';
  return 'unknown';
}

function isArc69Candidate(params: NftSourceParams): boolean {
  // ARC-69 typically uses the asset name + a config-txn note; URL is often empty
  // or points to a media file (image directly). Heuristic: no template markers.
  return !!(params.name || params.unitName);
}

async function resolveArc19Metadata(params: NftSourceParams): Promise<NftMetadata | null> {
  if (!params.url || !params.reserve) return null;
  const resolved = resolveArc19(params.url, params.reserve);
  if (!resolved) return null;
  return await loadArc3Json(resolved, 'arc-19', params);
}

async function resolveArc3Metadata(params: NftSourceParams): Promise<NftMetadata | null> {
  if (!params.url) return null;
  return await loadArc3Json(params.url, 'arc-3', params);
}

async function loadArc3Json(
  metadataUrl: string,
  variant: ArcVariant,
  params: NftSourceParams,
): Promise<NftMetadata | null> {
  const ipfsParsed = parseIpfsUri(metadataUrl);
  let res: Response;
  if (ipfsParsed) {
    res = await fetchIpfs(metadataUrl);
  } else if (metadataUrl.startsWith('http')) {
    res = await fetch(metadataUrl);
  } else {
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json()) as Record<string, unknown>;
  return {
    name: (typeof json.name === 'string' ? json.name : undefined) || params.name,
    description: typeof json.description === 'string' ? json.description : undefined,
    image: typeof json.image === 'string' ? json.image : undefined,
    mimeType: typeof json.image_mimetype === 'string' ? json.image_mimetype : undefined,
    traits: normalizeTraits(json.properties ?? json.attributes),
    arcVariant: variant,
  };
}

async function resolveArc69Metadata(
  assetId: number,
  network: NetworkId,
): Promise<NftMetadata | null> {
  // ARC-69 metadata lives in the most recent asset-config-txn's note field.
  const indexer = getIndexerClient(network);
  const resp = await indexer
    .lookupAssetTransactions(assetId)
    .txType('acfg')
    .limit(1)
    .do();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = resp.transactions?.[0];
  if (!tx?.note) return null;

  let json: Record<string, unknown>;
  try {
    const noteBytes: Uint8Array = tx.note instanceof Uint8Array
      ? tx.note
      : base64ToBytes(String(tx.note));
    const text = new TextDecoder().decode(noteBytes);
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (json.standard !== 'arc69') return null;
  return {
    name: typeof json.name === 'string' ? json.name : undefined,
    description: typeof json.description === 'string' ? json.description : undefined,
    image: typeof json.external_url === 'string' ? json.external_url : undefined,
    mimeType: typeof json.mime_type === 'string' ? json.mime_type : undefined,
    traits: normalizeTraits(json.properties ?? json.attributes),
    arcVariant: 'arc-69',
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function normalizeTraits(raw: unknown): Record<string, string | number> {
  if (!raw) return {};
  // ARC-3 / ARC-69: { properties: { traitKey: value } }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    }
    return out;
  }
  // OpenSea-style: [{ trait_type, value }]
  if (Array.isArray(raw)) {
    const out: Record<string, string | number> = {};
    for (const t of raw) {
      if (t && typeof t === 'object' && 'trait_type' in t && 'value' in t) {
        const tt = (t as { trait_type: unknown }).trait_type;
        const vv = (t as { value: unknown }).value;
        if (typeof tt === 'string' && (typeof vv === 'string' || typeof vv === 'number')) {
          out[tt] = vv;
        }
      }
    }
    return out;
  }
  return {};
}
