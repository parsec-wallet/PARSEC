// BANKON Marketspace Registry — read+write client. Mirrors src/lib/bankon-names/client.ts.

import type { DataItemInput, DataItemTag } from '../arweave/ans104';
import { aoDryRun, buildAoMessageInput, type AoMessageOutput } from '../arweave/ao';
import { getBmrProcessId, isBmrConfigured } from './process-id';

// ── Types ────────────────────────────────────────────────────

export type Namespace = 'bankon' | 'arns';
export type ListingStatus = 'open' | 'escrowed' | 'sold' | 'cancelled' | 'expired';
export type OfferStatus = 'pending' | 'accepted' | 'cancelled' | 'rejected';

export interface Listing {
  id: string;
  seller: string;
  namespace: Namespace;
  name: string;
  askPrice: string;
  currency: string;
  expiresAt?: number;
  isAuction: boolean;
  auction?: {
    minIncrement: string;
    endTime: number;
    currentBid?: string;
    currentBidder?: string;
  };
  status: ListingStatus;
  createdAt: number;
  buyer?: string;
  soldAt?: number;
}

export interface Offer {
  id: string;
  listingId: string;
  buyer: string;
  offerPrice: string;
  expiresAt?: number;
  status: OfferStatus;
}

export interface Trade {
  listingId: string;
  seller: string;
  buyer: string;
  price: string;
  fee?: string;
  sellerNet?: string;
  paymentMethod?: string;
  paymentProof?: string;
  ts: number;
}

export interface BmrInfo {
  name: string;
  version: string;
  listingCount: number;
  offerCount: number;
  controllers: string[];
  treasury: string;
  policy: {
    FeeBasisPoints: number;
    AcceptedNamespaces: string[];
    AcceptedCurrencies: string[];
    DefaultListingTtlMs: number;
    MinAuctionDurationMs: number;
    MaxAuctionDurationMs: number;
    Paused: boolean;
  };
}

function requireConfigured(): void {
  if (!isBmrConfigured()) {
    throw new Error('BANKON Marketspace Registry not yet spawned. Run scripts/spawn-bmr.mjs or use the in-wallet admin tab.');
  }
}

// ── Reads ────────────────────────────────────────────────────

export async function getBmrInfo(): Promise<BmrInfo | null> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBmrProcessId(),
    tags: [{ name: 'Action', value: 'Info' }],
  });
  return parseJsonOrNull<BmrInfo>(res);
}

export async function getListing(id: string): Promise<Listing | null> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBmrProcessId(),
    tags: [
      { name: 'Action', value: 'Get-Listing' },
      { name: 'Listing-Id', value: id },
    ],
  });
  return parseJsonOrNull<Listing>(res);
}

export async function listListings(opts: { status?: ListingStatus; namespace?: Namespace } = {}): Promise<Listing[]> {
  requireConfigured();
  const tags: DataItemTag[] = [{ name: 'Action', value: 'List-Listings' }];
  if (opts.status) tags.push({ name: 'Status', value: opts.status });
  if (opts.namespace) tags.push({ name: 'Namespace', value: opts.namespace });
  const res = await aoDryRun({ process: getBmrProcessId(), tags });
  const wrapped = parseJsonOrNull<{ items: Listing[] }>(res);
  return wrapped?.items ?? [];
}

export async function getMyListings(seller: string): Promise<Listing[]> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBmrProcessId(),
    tags: [
      { name: 'Action', value: 'My-Listings' },
      { name: 'Seller', value: seller },
    ],
  });
  const wrapped = parseJsonOrNull<{ items: Listing[] }>(res);
  return wrapped?.items ?? [];
}

export async function getMyOffers(buyer: string): Promise<Offer[]> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBmrProcessId(),
    tags: [
      { name: 'Action', value: 'My-Offers' },
      { name: 'Buyer', value: buyer },
    ],
  });
  const wrapped = parseJsonOrNull<{ items: Offer[] }>(res);
  return wrapped?.items ?? [];
}

// ── Writes (returns DataItemInput; caller signs + posts) ────

export interface CreateListingOpts {
  namespace: Namespace;
  name: string;
  askPrice: bigint;          // mARIO
  currency?: string;
  expiresAtMs?: number;
  auction?: {
    minIncrement: bigint;
    endTimeMs: number;
  };
}

export function buildCreateListingInput(opts: CreateListingOpts): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  const tags: DataItemTag[] = [
    { name: 'Action', value: 'Create-Listing' },
    { name: 'Namespace', value: opts.namespace },
    { name: 'Name', value: opts.name },
    { name: 'Ask-Price', value: opts.askPrice.toString() },
    { name: 'Currency', value: opts.currency ?? 'ARIO' },
  ];
  if (opts.expiresAtMs !== undefined) tags.push({ name: 'Expires-At-Ms', value: String(opts.expiresAtMs) });
  if (opts.auction) {
    tags.push({ name: 'Is-Auction', value: 'true' });
    tags.push({ name: 'Min-Increment', value: opts.auction.minIncrement.toString() });
    tags.push({ name: 'End-Time-Ms', value: String(opts.auction.endTimeMs) });
  }
  return buildAoMessageInput({ process: getBmrProcessId(), tags });
}

export function buildCancelListingInput(opts: { listingId: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBmrProcessId(),
    tags: [
      { name: 'Action', value: 'Cancel-Listing' },
      { name: 'Listing-Id', value: opts.listingId },
    ],
  });
}

export function buildMakeOfferInput(opts: { listingId: string; offerPrice: bigint; expiresAtMs?: number }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  const tags: DataItemTag[] = [
    { name: 'Action', value: 'Make-Offer' },
    { name: 'Listing-Id', value: opts.listingId },
    { name: 'Offer-Price', value: opts.offerPrice.toString() },
  ];
  if (opts.expiresAtMs !== undefined) tags.push({ name: 'Expires-At-Ms', value: String(opts.expiresAtMs) });
  return buildAoMessageInput({ process: getBmrProcessId(), tags });
}

export function buildAcceptOfferInput(opts: { offerId: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBmrProcessId(),
    tags: [
      { name: 'Action', value: 'Accept-Offer' },
      { name: 'Offer-Id', value: opts.offerId },
    ],
  });
}

export function buildBidInput(opts: { listingId: string; amount: bigint }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBmrProcessId(),
    tags: [
      { name: 'Action', value: 'Bid' },
      { name: 'Listing-Id', value: opts.listingId },
      { name: 'Bid-Amount', value: opts.amount.toString() },
    ],
  });
}

export function buildSettleAuctionInput(opts: { listingId: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBmrProcessId(),
    tags: [
      { name: 'Action', value: 'Settle-Auction' },
      { name: 'Listing-Id', value: opts.listingId },
    ],
  });
}

export interface SettleTradeOpts {
  listingId: string;
  offerId?: string;
  paymentMethod: 'ario' | 'algorand' | 'arweave-stake';
  paymentProof: string;
  paymentAmount: bigint;
}

export function buildSettleTradeInput(opts: SettleTradeOpts): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  const tags: DataItemTag[] = [
    { name: 'Action', value: 'Settle-Trade' },
    { name: 'Listing-Id', value: opts.listingId },
    { name: 'Payment-Method', value: opts.paymentMethod },
    { name: 'Payment-Proof', value: opts.paymentProof },
    { name: 'Payment-Amount', value: opts.paymentAmount.toString() },
  ];
  if (opts.offerId) tags.push({ name: 'Offer-Id', value: opts.offerId });
  return buildAoMessageInput({ process: getBmrProcessId(), tags });
}

// ── Internals ────────────────────────────────────────────────

function readData(out: AoMessageOutput): string | null {
  const data = (out as unknown as { Data?: unknown }).Data;
  if (data == null) return null;
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'bigint') return data.toString();
  try { return JSON.stringify(data); } catch { return null; }
}

function parseJsonOrNull<T>(out: AoMessageOutput): T | null {
  const data = readData(out);
  if (!data || data === 'null') return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
