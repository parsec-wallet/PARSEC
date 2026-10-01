// PARSEC Wallet — name stores (.algo subdomains and ArNS undernames): open a
// store, browse, quote, buy.
//
// Two registries, one scheme. A store is a root .algo name (selling
// label.yourname.algo) or an ArNS name (`arns`, selling undernames served at
// label_yourname.ar.io — BANKON's own store is `bankon`). The owner signs the
// listing with the name's own key: Algorand for .algo, Solana for ArNS.
//
// An owner of a root .algo name opens a store under it: `label.yourname.algo`,
// priced in USDC and tiered by length — 3 letters and shorter premium, 4
// valuable, 5 and longer standard. The listing is signed by the owner's key in
// the PARSEC Keycore (Algorand `MX`-prefixed bytes) and published to the
// store registry on mindX, which checks the signature and, with the NFD
// registry, that the signer owns the name. The registry holds listings, never
// keys or money. Design: docs/design/algo-registry.md.
//
// Buying is an order (free; it freezes price, fee and payout) paid in two x402
// payments, each settled by the facilitator: the BANKON fee to BANKON, which
// holds the name for 15 minutes, then the price straight to the store owner's
// payout address. The owner's wallet then mints the name for the buyer.
//
// The rules here mirror the registry's (mindx_backend_service/names_stores.py);
// `canonicalListing` must produce the same bytes Python's
// json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False) does.

import { algoSignBytes } from '../chain-algo';
import { solSign } from '../chain-sol';
import { parsecTransport } from '../x402/adapters/parsec';
import { x402Request, type X402PaymentResult } from '../x402/client';
import { ALGORAND_MAINNET, ALGORAND_TESTNET, sameNetwork, usdcFor } from '../x402/networks';
import type { X402Signers } from '../x402/host';
import type { NetworkId } from '../../types/wallet';

export const STORES_URL = 'https://mindx.pythai.net/names/stores';
export const LISTING_PREFIX = 'PARSEC store listing v1\n';
const MICRO = 1_000_000;

export type Tier = 'premium' | 'valuable' | 'standard';

/** Where a store lives: an Algorand network (.algo) or ArNS. */
export type StoreRegistry = 'mainnet' | 'testnet' | 'arns';

/** A wallet network → the .algo registry it shops in. */
export function algoRegistry(network: NetworkId): StoreRegistry {
  return network === 'testnet' ? 'testnet' : 'mainnet';
}

/** Which labels a registry sells: .algo a–z 0–9 up to 27; ArNS also inner hyphens, up to 61. */
export function labelValid(registry: StoreRegistry, label: string): boolean {
  return registry === 'arns' ? /^[a-z0-9](?:[a-z0-9-]{0,59}[a-z0-9])?$/.test(label) : /^[a-z0-9]{1,27}$/.test(label);
}

/** alice.mindx.algo · alice_bankon (served at alice_bankon.ar.io). */
export function fullName(registry: StoreRegistry, parent: string, label: string): string {
  return registry === 'arns' ? `${label}_${parent}` : `${label}.${parent}`;
}

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

/** BANKON facilitation fee: 10 % of the price, at least $0.05, paid by the buyer on top. */
export const FEE_BPS = 1_000;
export const FEE_MIN_MICRO = 50_000;
export function bankonFeeMicro(priceMicro: number): number {
  return Math.max(Math.floor((priceMicro * FEE_BPS) / 10_000), FEE_MIN_MICRO);
}

export interface StoreListing {
  network: StoreRegistry;
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

/** Labels the registry sells, deduplicated. */
export function cleanLabels(text: string, registry: StoreRegistry = 'mainnet'): string[] {
  return [...new Set(text.toLowerCase().split(/[\s,]+/).map((s) => s.trim()).filter((s) => labelValid(registry, s)))];
}

/** Sign a listing with the owner's key (PARSEC Keycore) and publish it. */
export async function publishListing(listing: StoreListing): Promise<{ ok: boolean; status: string }> {
  const bytes = canonicalListing(listing);
  const b64 = btoa(String.fromCharCode(...bytes));
  // .algo: Algorand's MX-prefixed data signature. ArNS: the Solana key signs the bytes as they are.
  const { signature_b64 } = listing.network === 'arns' ? await solSign(listing.owner, b64) : await algoSignBytes(listing.owner, b64);
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
  pay_network?: string;
  note: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await parsecTransport(url, { headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => ({})) as { detail?: { message?: string; code?: string } };
  if (!res.ok) throw new Error(data.detail?.message ?? data.detail?.code ?? `The registry answered ${res.status}.`);
  return data as T;
}

export async function listStores(network: StoreRegistry): Promise<Store[]> {
  const r = await getJson<{ stores: Store[] }>(`${STORES_URL}?network=${encodeURIComponent(network)}`);
  return r.stores ?? [];
}

export async function getStore(parent: string, network: StoreRegistry): Promise<Store | null> {
  try {
    return await getJson<Store>(`${STORES_URL}/${encodeURIComponent(parent)}?network=${encodeURIComponent(network)}`);
  } catch { return null; }
}

export async function quoteName(parent: string, label: string, network: StoreRegistry): Promise<StoreQuote> {
  return getJson<StoreQuote>(`${STORES_URL}/${encodeURIComponent(parent)}/quote?label=${encodeURIComponent(label)}&network=${encodeURIComponent(network)}`);
}

// ── Orders ──────────────────────────────────────────────────────────────────

export type OrderState = 'quoted' | 'fee_paid' | 'paid' | 'minted' | 'refunded';
export type OrderStep = 'fee' | 'pay';

export interface StoreOrder {
  ref: string;
  network: StoreRegistry;
  name: string;
  parent: string;
  label: string;
  buyer: string;
  payout: string;
  price_micro_usd: number;
  bankon_fee_micro_usd: number;
  total_micro_usd: number;
  state: OrderState;
  fee_settlement: string | null;
  settlement: string | null;
  mint_tx: string | null;
  held_until: string | null;
  created_at: string;
  updated_at: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await parsecTransport(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { detail?: { message?: string; code?: string } };
  if (!res.ok) throw new Error(data.detail?.message ?? data.detail?.code ?? `The registry answered ${res.status}.`);
  return data as T;
}

/** Order `label.parent` for `buyer`. Free; freezes the price, the fee and the payout. */
export function createOrder(parent: string, label: string, buyer: string, network: StoreRegistry): Promise<StoreOrder> {
  return postJson<StoreOrder>(`${STORES_URL}/${encodeURIComponent(parent)}/order`, { label, buyer, network });
}

export function getOrder(ref: string): Promise<StoreOrder> {
  return getJson<StoreOrder>(`${STORES_URL}/orders/${encodeURIComponent(ref)}`);
}

export async function buyerOrders(buyer: string): Promise<StoreOrder[]> {
  const r = await getJson<{ orders: StoreOrder[] }>(`${STORES_URL}/orders?buyer=${encodeURIComponent(buyer)}`);
  return r.orders ?? [];
}

/** What a step must charge — the terms the payment is checked against before signing. */
export function stepTerms(order: StoreOrder, step: OrderStep): { network: string; asset: string; amount: string; payTo: string | null } {
  // ArNS stores are paid on Algorand mainnet, like mainnet .algo stores.
  const network = order.network === 'testnet' ? ALGORAND_TESTNET : ALGORAND_MAINNET;
  return {
    network,
    asset: usdcFor(network),
    amount: String(step === 'fee' ? order.bankon_fee_micro_usd : order.price_micro_usd),
    // The price goes to the store's payout address, frozen on the order. The fee goes
    // to BANKON's address, which the server names; amount, asset and network still bind it.
    payTo: step === 'pay' ? order.payout : null,
  };
}

/**
 * Pay one step of an order over x402.
 *
 * The buyer approved the order's figures on the order screen, so approval here is a
 * check, not a prompt: the offer must be on the order's network, in USDC, for exactly
 * the order's amount and — for the price — to the order's payout address. Anything
 * else is refused before a signature is made. A step already paid is not charged again
 * (the server answers with the order instead of a 402).
 */
export async function payOrderStep(order: StoreOrder, step: OrderStep, signers: X402Signers): Promise<{ order: StoreOrder; txId: string | null; result: X402PaymentResult }> {
  const want = stepTerms(order, step);
  const result = await x402Request(`${STORES_URL}/orders/${encodeURIComponent(order.ref)}/${step}`, { method: 'POST' }, {
    signers,
    preferNetwork: want.network,
    approve: async (pending) => {
      if (pending.preflight && !pending.preflight.ok) {
        throw new Error(pending.preflight.blockers.map((b) => b.message).join(' '));
      }
      const r = pending.requirement;
      const same = sameNetwork(r.network, want.network)
        && String(r.asset) === want.asset
        && String(pending.quote.amountAtomic) === want.amount
        && (want.payTo === null || r.payTo === want.payTo);
      if (!same) throw new Error(`The ${step === 'fee' ? 'BANKON fee' : 'price'} asked for is not the one on your order. Nothing was paid.`);
      return true;
    },
  });
  if (!result.success) throw new Error(result.error || `The ${step === 'fee' ? 'BANKON fee' : 'price'} did not settle.`);
  let next = order;
  try {
    const body = result.response ? await result.response.clone().json() : null;
    if (body && typeof body === 'object' && 'ref' in body) next = body as StoreOrder;
  } catch { /* the settlement id is the proof; the order can be re-read */ }
  return { order: next, txId: result.txId ?? null, result };
}

/** micro-USD → "$3" / "$0.15". */
export function usd(micro: number): string {
  const whole = Math.floor(micro / MICRO);
  const frac = micro % MICRO;
  if (frac === 0) return `$${whole.toLocaleString()}`;
  return `$${(micro / MICRO).toFixed(2)}`;
}
