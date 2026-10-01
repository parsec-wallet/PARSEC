// Namespace adapter — cypherpunk2048 standard, principle #4 (chain-pack
// architecture). Each name registry (ArNS, BANKON Names, future: ENS,
// SNS, etc.) implements this interface; the unified name-* views consume
// the active adapter rather than branching on namespace strings.
//
// Optional methods (canSetControllers + addController etc.) let adapters
// declare partial capability; the UI hides controls the adapter doesn't
// support without per-namespace special-casing.

import type { AddressChain, NameIdentityFields } from '../names/controller-model';

/** A name's token identity: how explorers and gateways label it. */
export type NameIdentity = NameIdentityFields;

/**
 * Normalized record shape every namespace produces. Adapter-specific
 * fields live under `raw`; everything the UI needs is at the top level.
 */
export interface NormalizedRecord {
  /** Lowercase name string. */
  name: string;
  /** Owner address (Arweave for BANKON / ArNS; future namespaces may use a different format). */
  owner: string;
  /** Controllers that can mutate records without being owner (ArNS only). */
  controllers?: string[];
  /** lease | permabuy. */
  type: 'lease' | 'permabuy';
  /** Lease expiry, ms epoch. Undefined for permabuy. */
  endTimestamp?: number;
  /** Root @ record's target tx-id. */
  rootTarget?: string;
  /** Root @ record's TTL in seconds. */
  rootTtl: number;
  /** Map of subdomain -> { transactionId, ttlSeconds }. */
  undernames: Record<string, { transactionId: string; ttlSeconds: number }>;
  /** Configured undername limit for this name. Undefined if the namespace doesn't gate. */
  undernameLimit?: number;
  /** Original adapter-typed record for ad-hoc reads. */
  raw: unknown;
}

export type ClaimIntent = 'Buy-Name' | 'Extend-Lease' | 'Increase-Undername-Limit';
export type PurchaseType = 'lease' | 'permabuy';

export interface CostQuery {
  intent: ClaimIntent;
  name: string;
  years?: number;
  purchaseType?: PurchaseType;
  quantity?: number;
  paymentMethod?: string;  // optional; some adapters take a method here
}

export interface CostQuote {
  /** Amount in the adapter's smallest unit (mARIO, microALGO, winston, …). */
  amount: bigint;
  /** Human label for the unit, e.g. "ARIO". */
  unit: string;
}

export interface SignedWrite {
  /** AO DataItem id (or equivalent transaction id) of the signed write. */
  id: string;
}

export interface NamespaceCapabilities {
  /** True if the adapter exposes `addController` / `removeController`. */
  controllers: boolean;
  /** True if the adapter exposes `increaseUndernameLimit`. */
  increaseUndernameLimit: boolean;
  /** True if claims require a separate child-process spawn (ArNS = true, BANKON = false). */
  spawnsChildProcess: boolean;
  /** Payment methods accepted by `claim`. */
  acceptedPaymentMethods: string[];
}

/**
 * NamespaceAdapter — the unified surface for any name registry the wallet
 * supports. The active adapter is resolved via `getNamespace(id)` from
 * `src/lib/namespaces/registry.ts`.
 *
 * Each method that signs takes `(address, passphrase)` so the implementation
 * can route through the vault-bridged signer. The adapter implementations
 * themselves never custody keys — they delegate to `signDataItemFromVault`
 * (or equivalent) from the underlying chain pack.
 */
export interface NamespaceAdapter {
  /** Short id, e.g. 'arns' or 'bankon'. URL-safe. */
  readonly id: string;
  /** Human-readable name, e.g. 'AR.IO Names' / 'BANKON Names'. */
  readonly displayName: string;
  /** What the adapter can do, for the UI to gate optional sections. */
  readonly capabilities: NamespaceCapabilities;
  /** Which of the account's addresses this namespace signs with. Default 'arweave-hd'. */
  readonly addressChain?: AddressChain;

  // ── Reads ──────────────────────────────────────────────────

  /** Fetch a normalized record. Null if the name is unregistered. */
  getRecord(name: string): Promise<NormalizedRecord | null>;

  /** Names owned by an address. May be slow on large namespaces; UI shows a spinner. */
  getOwnedRecords(owner: string): Promise<NormalizedRecord[]>;

  /** Cost preview for an intent. */
  getCost(query: CostQuery): Promise<CostQuote>;

  /** True if a name is currently reserved (cannot be claimed by random address). */
  isReserved(name: string): Promise<boolean>;

  // ── Writes (vault-bridged) ────────────────────────────────

  /** Claim a name. v1 BANKON uses `payment.method = 'free'` during open beta;
   *  ArNS requires ARIO. The adapter handles payment-proof tag assembly. */
  claim(opts: {
    address: string;
    passphrase: string;
    name: string;
    purchaseType: PurchaseType;
    years?: number;
    paymentMethod: string;
    paymentProof?: string;
    paymentAmount?: bigint;
  }): Promise<SignedWrite & { childProcessId?: string }>;

  /** Set the root @ record. */
  setRootRecord(opts: {
    address: string;
    passphrase: string;
    name: string;
    transactionId: string;
    ttlSeconds?: number;
  }): Promise<SignedWrite>;

  /** Set or update an undername. */
  setUndername(opts: {
    address: string;
    passphrase: string;
    name: string;
    subdomain: string;
    transactionId: string;
    ttlSeconds?: number;
  }): Promise<SignedWrite>;

  /** Remove an undername. */
  removeUndername(opts: {
    address: string;
    passphrase: string;
    name: string;
    subdomain: string;
  }): Promise<SignedWrite>;

  /** Extend a lease. */
  extendLease(opts: {
    address: string;
    passphrase: string;
    name: string;
    years: number;
  }): Promise<SignedWrite>;

  /** Transfer ownership to another address. */
  transferOwnership(opts: {
    address: string;
    passphrase: string;
    name: string;
    to: string;
  }): Promise<SignedWrite>;

  /** Request a name as primary identity for the active address (some adapters
   *  require a follow-up acknowledge — the adapter handles the dance internally). */
  requestPrimary(opts: {
    address: string;
    passphrase: string;
    name: string;
  }): Promise<SignedWrite>;

  // ── Optional capabilities ─────────────────────────────────

  /** Add a controller. Adapter-gated via `capabilities.controllers`. */
  addController?(opts: {
    address: string;
    passphrase: string;
    name: string;
    controller: string;
  }): Promise<SignedWrite>;

  /** Remove a controller. */
  removeController?(opts: {
    address: string;
    passphrase: string;
    name: string;
    controller: string;
  }): Promise<SignedWrite>;

  /** Read the name's token identity (nickname, ticker, description, keywords, logo). */
  getIdentity?(name: string): Promise<NameIdentity>;

  /** Write changed identity fields; each changed field is one signed write. */
  setIdentity?(opts: {
    address: string;
    passphrase: string;
    name: string;
    patch: Partial<NameIdentity>;
  }): Promise<SignedWrite>;

  /** Increase the undername limit. Some adapters gate this. */
  increaseUndernameLimit?(opts: {
    address: string;
    passphrase: string;
    name: string;
    quantity: number;
  }): Promise<SignedWrite>;
}
