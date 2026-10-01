// PARSEC Wallet — .algo subdomain stores (phase 1: open a store, browse, quote).
//
// An owner of a root .algo name opens a store under it: `label.yourname.algo`,
// priced in USDC and tiered by length — 3 letters and shorter premium, 4
// valuable, 5 and longer standard. The listing is signed by the owner's key in
// the PARSEC Keycore (Algorand `MX`-prefixed bytes) and published to the
// store registry on mindX, which checks the signature and, with the NFD
// registry, that the signer owns the name. The registry holds listings, never
// keys or money. Design: docs/design/algo-registry.md.
//
// The rules here mirror the registry's (mindx_backend_service/names_stores.py);
// `canonicalListing` must produce the same bytes Python's
// json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False) does.

import { algoSignBytes } from '../chain-algo';
import { parsecTransport } from '../x402/adapters/parsec';
import type { NetworkId } from '../../types/wallet';

export const STORES_URL = 'https://mindx.pythai.net/names/stores';
export const LISTING_PREFIX = 'PARSEC store listing v1\n';
const MICRO = 1_000_000;

export type Tier = 'premium' | 'valuable' | 'standard';

/** Suggested tier prices, micro-USD: $50 · $15 · $3. Owners change them. */
export const SUGGESTED_TIERS: Record<Tier, number> = { premium: 50 * MICRO, valuable: 15 * MICRO, standard: 3 * MICRO };

export const TIER_LABEL: Record<Tier, string> = {
  premium: 'Premium · 3 letters or fewer',
  valuable: 'Valuable · 4 letters',
  standard: 'Standard · 5 letters or more',
};

export function tierFor(label: string): Tier {
  const n = [...label].length;
  return n <= 3 ? 'premium' : n === 4 ? 'valuable' : 'standard';
}

/** BANKON facilitation fee: 5 % of the price, at least $0.10, paid by the buyer on top. */
export function bankonFeeMicro(priceMicro: number): number {
  return Math.max(Math.floor((priceMicro * 500) / 10_000), 100_000);
}

export interface StoreListing {
  network: 'mainnet' | 'testnet';
  parent: string;
  owner: string;
  payout: string;
  tiers: Record<Tier, number>;
  reserved: string[];
  featured: string[];
  issued_at: string;
  closed?: boolean;
}

function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** The exact bytes an owner signs. */
export function canonicalListing(listing: StoreListing): Uint8Array {
  return new TextEncoder().encode(LISTING_PREFIX + sortedJson(listing));
}

/** Labels: 1–27 of a–z and 0–9. */
export function cleanLabels(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^[a-z0-9]{1,27}$/.test(s)))];
}

/** Sign a listing with the owner's key (PARSEC Keycore) and publish it. */
export async function publishListing(listing: StoreListing): Promise<{ ok: boolean; status: string }> {
  const bytes = canonicalListing(listing);
  const { signature_b64 } = await algoSignBytes(listing.owner, btoa(String.fromCharCode(...bytes)));
  const res = await parsecTransport(STORES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ listing, signature: signature_b64 }),
  });
  const data = await res.json().catch(() => ({})) as { detail?: { message?: string; code?: string }; status?: string; ok?: boolean };
  if (!res.ok) throw new Error(data.detail?.message ?? data.detail?.code ?? `The registry answered ${res.status}.`);
  return { ok: true, status: data.status ?? 'open' };
}

export interface Store {
  parent: string;
  network: string;
  owner: string;
  payout: string;
  tiers_micro_usd: Record<Tier, number>;
  featured: string[];
  status: string;
  updated_at: string;
}

export interface StoreQuote {
  name: string;
  tier: Tier;
  available: boolean;
  reason: string | null;
  price_micro_usd: number;
  bankon_fee_micro_usd: number;
  total_micro_usd: number;
  payout: string;
  note: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await parsecTransport(url, { headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => ({})) as { detail?: { message?: string; code?: string } };
  if (!res.ok) throw new Error(data.detail?.message ?? data.detail?.code ?? `The registry answered ${res.status}.`);
  return data as T;
}

export async function listStores(network: NetworkId): Promise<Store[]> {
  const r = await getJson<{ stores: Store[] }>(`${STORES_URL}?network=${encodeURIComponent(network)}`);
  return r.stores ?? [];
}

export async function getStore(parent: string, network: NetworkId): Promise<Store | null> {
  try {
    return await getJson<Store>(`${STORES_URL}/${encodeURIComponent(parent)}?network=${encodeURIComponent(network)}`);
  } catch { return null; }
}

export async function quoteName(parent: string, label: string, network: NetworkId): Promise<StoreQuote> {
  return getJson<StoreQuote>(`${STORES_URL}/${encodeURIComponent(parent)}/quote?label=${encodeURIComponent(label)}&network=${encodeURIComponent(network)}`);
}

/** micro-USD → "$3" / "$0.15". */
export function usd(micro: number): string {
  const whole = Math.floor(micro / MICRO);
  const frac = micro % MICRO;
  if (frac === 0) return `$${whole.toLocaleString()}`;
  return `$${(micro / MICRO).toFixed(2)}`;
}
