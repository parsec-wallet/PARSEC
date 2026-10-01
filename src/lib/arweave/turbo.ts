// Turbo — put bytes on Arweave through ar.io's bundler service, from inside the wallet.
//
// Parsec-owned and dependency-free, the way ao.ts replaces @permaweb/aoconnect: the SDK brings a
// transport stack and its own signers, and all this needs is two GETs and one POST.
//
// Verified 2026-09-10 against @ardrive/turbo-sdk (packages/turbo-sdk/src/common/upload.ts: HTTP
// base `${url}/v1`, endpoint `/tx/${token}`, token defaults to 'arweave') and the live services:
//   POST https://upload.ardrive.io/v1/tx/arweave         raw signed item, application/octet-stream
//   GET  https://upload.ardrive.io/v1/info               freeUploadLimitBytes: 107,520 — not 100 KiB
//   GET  https://payment.ardrive.io/v1/price/bytes/<n>   { winc }
// The free limit counts the whole signed data item (tags and headers included), so plans use
// estimateDataItemSize, which is exact.
//
// Signing: on desktop the deep-hash goes to Rust (`chain_ar_sign`) and only a signature comes back
// — the key never enters JS. The browser build has no Rust, so it signs with the vault JWK and
// zeroes it after (signDataItemFromVault), the fallback every Arweave write in the web build uses.

import { isTauri } from '../platform';
import { arAccountInfo, arSign } from '../chain-ar';
import {
  estimateDataItemSize,
  signDataItemFromVault,
  signDataItemWith,
  type DataItemInput,
  type DataItemTag,
  type SignedDataItem,
} from './ans104';
import { MANIFEST_CONTENT_TYPE, buildPathManifest, encodeManifest } from './manifest';

export const TURBO_UPLOAD_URL = 'https://upload.ardrive.io';
export const TURBO_PAYMENT_URL = 'https://payment.ardrive.io';
export const TURBO_GATEWAY = 'https://turbo-gateway.com';
/** Used only when /v1/info cannot be read. The live value on 2026-09-10. */
export const FREE_LIMIT_FALLBACK_BYTES = 107_520;
/** winc and winston are the same unit: 10^12 per AR. */
export const WINC_DECIMALS = 12;

export const APP_TAGS: readonly DataItemTag[] = [{ name: 'App-Name', value: 'Parsec' }];

// ── Service reads ─────────────────────────────────────────────────────────────

export interface TurboInfo {
  readonly freeUploadLimitBytes: number;
  readonly gateway: string;
  /** False when the service was unreachable and the numbers are fallbacks. */
  readonly live: boolean;
}

export async function getTurboInfo(): Promise<TurboInfo> {
  try {
    const res = await fetch(`${TURBO_UPLOAD_URL}/v1/info`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { freeUploadLimitBytes?: unknown; gateway?: unknown };
    const limit = typeof j.freeUploadLimitBytes === 'number' && j.freeUploadLimitBytes > 0
      ? j.freeUploadLimitBytes : FREE_LIMIT_FALLBACK_BYTES;
    return { freeUploadLimitBytes: limit, gateway: typeof j.gateway === 'string' ? j.gateway : TURBO_GATEWAY, live: true };
  } catch {
    return { freeUploadLimitBytes: FREE_LIMIT_FALLBACK_BYTES, gateway: TURBO_GATEWAY, live: false };
  }
}

/** Price of `bytes` in winc, exact. Throws on anything malformed — a price is never guessed. */
export async function getTurboPriceWinc(bytes: number): Promise<bigint> {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('bytes must be a non-negative integer');
  const res = await fetch(`${TURBO_PAYMENT_URL}/v1/price/bytes/${bytes}`);
  if (!res.ok) throw new Error(`Turbo price: HTTP ${res.status}`);
  const j = (await res.json()) as { winc?: unknown };
  if (typeof j.winc !== 'string' || !/^\d+$/.test(j.winc)) throw new Error('Turbo price: malformed winc');
  return BigInt(j.winc);
}

// ── Posting ───────────────────────────────────────────────────────────────────

export interface TurboReceipt {
  readonly id: string;
  readonly owner: string;
  readonly winc: string;
  readonly dataCaches: readonly string[];
  readonly fastFinalityIndexes: readonly string[];
  readonly timestamp?: number;
  readonly deadlineHeight?: number;
}

export class TurboError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'TurboError';
  }
}

export async function postDataItem(raw: Uint8Array): Promise<TurboReceipt> {
  const res = await fetch(`${TURBO_UPLOAD_URL}/v1/tx/arweave`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: raw as unknown as BodyInit,
  });
  const text = await res.text();
  if (res.status === 402) {
    throw new TurboError('This item is over the free limit and the signing address holds no Turbo credits.', 402);
  }
  if (!res.ok) throw new TurboError(`Turbo upload: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`, res.status);
  let j: Record<string, unknown>;
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { throw new TurboError('Turbo upload: response was not JSON', res.status); }
  if (typeof j.id !== 'string') throw new TurboError('Turbo upload: response had no id', res.status);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    id: j.id,
    owner: typeof j.owner === 'string' ? j.owner : '',
    winc: typeof j.winc === 'string' ? j.winc : '0',
    dataCaches: list(j.dataCaches),
    fastFinalityIndexes: list(j.fastFinalityIndexes),
    ...(typeof j.timestamp === 'number' ? { timestamp: j.timestamp } : {}),
    ...(typeof j.deadlineHeight === 'number' ? { deadlineHeight: j.deadlineHeight } : {}),
  };
}

// ── Signing ───────────────────────────────────────────────────────────────────

/** Sign a data item for `owner`. Supplied per platform by uploadSignerFor. */
export type UploadSigner = (input: Omit<DataItemInput, 'owner'>) => Promise<SignedDataItem>;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * The signer for this platform. Desktop: Rust signs the deep-hash and the key stays in the vault.
 * Browser build: the vault JWK signs in WebCrypto and is zeroed after — it needs the passphrase.
 */
export function uploadSignerFor(address: string, passphrase: string | null): UploadSigner {
  if (isTauri) {
    let owner: string | undefined;
    return async (input) => {
      owner ??= (await arAccountInfo(address)).owner;
      return signDataItemWith({ ...input, owner }, async (sigData) => fromB64((await arSign(address, toB64(sigData))).signature_b64));
    };
  }
  if (!passphrase) throw new Error('Wallet is locked');
  return (input) => signDataItemFromVault(address, passphrase, input);
}

// ── Planning ──────────────────────────────────────────────────────────────────

export interface UploadFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface PlannedItem {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly tags: readonly DataItemTag[];
  /** Exact signed size in bytes. */
  readonly size: number;
  readonly free: boolean;
}

export interface UploadPlan {
  readonly items: readonly PlannedItem[];
  /** Present when the upload is a site: several files, or one file uploaded as a site. */
  readonly manifest?: { readonly size: number; readonly free: boolean; readonly index?: string; readonly fallback?: string };
  readonly totalBytes: number;
  readonly allFree: boolean;
  readonly freeLimit: number;
}

function tagsFor(contentType: string): DataItemTag[] {
  return [{ name: 'Content-Type', value: contentType }, ...APP_TAGS];
}

const PLACEHOLDER_ID = '_'.repeat(43);

export function planUpload(files: readonly UploadFile[], freeLimit: number, opts: { asSite?: boolean } = {}): UploadPlan {
  if (files.length === 0) throw new Error('Nothing to upload');
  const items: PlannedItem[] = files.map((f) => {
    const tags = tagsFor(f.contentType);
    const size = estimateDataItemSize({ dataLength: f.bytes.length, tags });
    return { path: f.path, bytes: f.bytes, tags, size, free: size <= freeLimit };
  });

  let manifest: UploadPlan['manifest'];
  if (files.length > 1 || opts.asSite) {
    const paths = new Set(files.map((f) => f.path));
    const index = paths.has('index.html') ? 'index.html' : undefined;
    const fallback = paths.has('404.html') ? '404.html' : undefined;
    // Every id is 43 characters, so a manifest built from placeholders has the exact final length.
    const json = encodeManifest(buildPathManifest(files.map((f) => ({ path: f.path, id: PLACEHOLDER_ID })), { ...(index ? { index } : {}), ...(fallback ? { fallbackPath: fallback } : {}) }));
    const size = estimateDataItemSize({ dataLength: new TextEncoder().encode(json).length, tags: tagsFor(MANIFEST_CONTENT_TYPE) });
    manifest = { size, free: size <= freeLimit, ...(index ? { index } : {}), ...(fallback ? { fallback } : {}) };
  }

  const totalBytes = items.reduce((n, i) => n + i.size, 0) + (manifest?.size ?? 0);
  const allFree = items.every((i) => i.free) && (manifest?.free ?? true);
  return { items, ...(manifest ? { manifest } : {}), totalBytes, allFree, freeLimit };
}

// ── Running ───────────────────────────────────────────────────────────────────

export interface UploadedItem {
  readonly path: string;
  readonly id: string;
  /** The payload bytes — what a gateway serves at /raw/<id>, and what verification hashes. */
  readonly bytes: Uint8Array;
  readonly receipt: TurboReceipt;
}

export interface UploadResult {
  readonly items: readonly UploadedItem[];
  readonly manifest?: UploadedItem;
  /** What to point a name at: the manifest for a site, else the single file. */
  readonly rootId: string;
}

export type UploadEvent =
  | { readonly kind: 'signing'; readonly path: string; readonly n: number; readonly of: number }
  | { readonly kind: 'uploaded'; readonly path: string; readonly id: string; readonly n: number; readonly of: number };

/**
 * Sign and post every planned item in order, then the manifest. Sequential on purpose: a partial
 * failure leaves a clear list of what landed, and Turbo rate-limits bursts from one address.
 * A receipt whose id differs from the id we signed is refused — the id is ours, not the server's.
 */
export async function runUpload(
  plan: UploadPlan,
  sign: UploadSigner,
  onEvent: (e: UploadEvent) => void = () => {},
  post: (raw: Uint8Array) => Promise<TurboReceipt> = postDataItem,
): Promise<UploadResult> {
  const of = plan.items.length + (plan.manifest ? 1 : 0);
  const done: UploadedItem[] = [];

  const put = async (path: string, bytes: Uint8Array, tags: readonly DataItemTag[]): Promise<UploadedItem> => {
    const n = done.length + 1;
    onEvent({ kind: 'signing', path, n, of });
    const signed = await sign({ data: bytes, tags: [...tags] });
    const receipt = await post(signed.raw);
    if (receipt.id !== signed.id) throw new Error(`Turbo returned id ${receipt.id} for an item signed as ${signed.id}`);
    const up = { path, id: signed.id, bytes, receipt };
    onEvent({ kind: 'uploaded', path, id: signed.id, n, of });
    return up;
  };

  for (const item of plan.items) done.push(await put(item.path, item.bytes, item.tags));

  if (!plan.manifest) return { items: done, rootId: done[0].id };

  const m = plan.manifest;
  const json = encodeManifest(buildPathManifest(done.map((d) => ({ path: d.path, id: d.id })), {
    ...(m.index ? { index: m.index } : {}),
    ...(m.fallback ? { fallbackPath: m.fallback } : {}),
  }));
  const manifest = await put('(manifest)', new TextEncoder().encode(json), tagsFor(MANIFEST_CONTENT_TYPE));
  return { items: done, manifest, rootId: manifest.id };
}
