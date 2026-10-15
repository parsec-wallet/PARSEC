// Name-controller model — the pure half of the per-name controller view (src/views/name-controller.ts).
// Validation, URL building, identity diffs and the gateway verify probe live here so they can be
// unit-tested without a DOM. No SDK, no vault, no store.

import { isSolanaAddress } from '../solana/address';

/** The manifest every fresh ar.io name points at until its owner sets a target. */
export const ARIO_PLACEHOLDER_TARGET = 'T9_V2HfiAq5qlLzObfyayj2-cjPujxpg25TRi4OZbe4';

/** Public ar.io gateways worth checking a name on, in the order the controller lists them. */
export const PUBLIC_GATEWAYS = ['ar.io', 'arweave.net', 'permagate.io'] as const;

/** ANT record TTL bounds (ar.io: 60 s .. 86400 s). */
export const TTL_MIN = 60;
export const TTL_MAX = 86_400;
export const TTL_OPTIONS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 60, label: '1 minute — while iterating' },
  { seconds: 900, label: '15 minutes — ar.io default' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86_400, label: '1 day — settled content' },
];

export type AddressChain = 'arweave-hd' | 'solana';

export interface NameIdentityFields {
  nickname: string;
  ticker: string;
  description: string;
  keywords: string[];
  logo: string;
}

/** 43-char base64url — an Arweave tx / data-item / manifest id. */
export function isArweaveId(s: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(s.trim());
}

/** Validate an owner/controller address for the chain a namespace lives on. */
export function validateAddressFor(chain: AddressChain, s: string): { ok: boolean; reason?: string } {
  const v = s.trim();
  if (!v) return { ok: false, reason: 'Enter an address' };
  if (chain === 'solana') {
    return isSolanaAddress(v) ? { ok: true } : { ok: false, reason: 'Not a base58 Solana address' };
  }
  return isArweaveId(v) ? { ok: true } : { ok: false, reason: 'Not a 43-character Arweave address' };
}

/** Undername rules: 1–61 chars, a-z 0-9 and hyphen, no leading/trailing hyphen, never "@". */
export function validateUndername(s: string): { ok: boolean; value: string; reason?: string } {
  const value = s.trim().toLowerCase();
  if (!value) return { ok: false, value, reason: 'Enter an undername' };
  if (value === '@') return { ok: false, value, reason: '"@" is the root record — set it above' };
  if (value.length > 61) return { ok: false, value, reason: 'At most 61 characters' };
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return { ok: false, value, reason: 'Use a–z, 0–9 and hyphens; no leading or trailing hyphen' };
  }
  return { ok: true, value };
}

export function clampTtl(n: number): number {
  if (!Number.isFinite(n)) return 900;
  return Math.min(TTL_MAX, Math.max(TTL_MIN, Math.round(n)));
}

/** `https://[undername_]name.gateway` — how ar.io gateways expose a record. */
export function gatewayUrl(name: string, gateway: string, undername?: string): string {
  const host = undername && undername !== '@' ? `${undername}_${name}` : name;
  return `https://${host}.${gateway}`;
}

/** Every public URL for a record, plus the operator's own gateway when one is configured. */
export function recordUrls(name: string, undername?: string, ownGateway?: string): string[] {
  const gws: string[] = [...PUBLIC_GATEWAYS];
  if (ownGateway && !gws.includes(ownGateway)) gws.unshift(ownGateway);
  return gws.map((g) => gatewayUrl(name, g, undername));
}

export function parseKeywords(s: string): string[] {
  return Array.from(new Set(s.split(/[,\n]/).map((k) => k.trim()).filter(Boolean)));
}

/** Only the identity fields that actually changed — each one is a separate on-chain write. */
export function identityDiff(
  current: NameIdentityFields,
  next: NameIdentityFields,
): Partial<NameIdentityFields> {
  const out: Partial<NameIdentityFields> = {};
  if (next.nickname.trim() !== current.nickname) out.nickname = next.nickname.trim();
  if (next.ticker.trim() !== current.ticker) out.ticker = next.ticker.trim();
  if (next.description.trim() !== current.description) out.description = next.description.trim();
  if (next.keywords.join('\0') !== current.keywords.join('\0')) out.keywords = next.keywords;
  if (next.logo.trim() !== current.logo) out.logo = next.logo.trim();
  return out;
}

export interface GatewayProbe {
  url: string;
  ok: boolean;
  status: number;
  /** `x-arns-resolved-id` as served; undefined when the gateway has not indexed the name yet. */
  resolvedId?: string;
  /** True when the gateway serves exactly the id the controller expects. */
  matches?: boolean;
  error?: string;
}

/**
 * Ask a gateway what it currently serves for a record. HEAD keeps it cheap; the resolved id comes
 * from the `x-arns-resolved-id` header every ar.io gateway sets. `expected` is the id the controller
 * just wrote (or the current @), so a stale cache shows as "not yet" rather than "wrong".
 */
export async function probeGateway(
  url: string,
  expected: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayProbe> {
  try {
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'manual' });
    const resolvedId = res.headers.get('x-arns-resolved-id') ?? undefined;
    return {
      url,
      ok: res.ok,
      status: res.status,
      resolvedId,
      matches: expected && resolvedId ? resolvedId === expected : undefined,
    };
  } catch (e) {
    return { url, ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One-line human state of a record, for the header stamp. */
export function describeTarget(target: string | undefined): { stamp: string; tone: 'done' | 'warn' | 'alert' } {
  if (!target) return { stamp: 'No target', tone: 'alert' };
  if (target === ARIO_PLACEHOLDER_TARGET) return { stamp: 'ar.io placeholder', tone: 'warn' };
  return { stamp: 'Pointing at content', tone: 'done' };
}

export function truncId(a: string | undefined, head = 8, tail = 6): string {
  if (!a) return '—';
  if (a.length <= head + tail + 3) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

// ── The Target field: what people paste, and what it really points at ──────────

/**
 * What a pasted target turned out to be. People paste what other tools gave them — an IPFS CID, a
 * gateway URL, `ar://…`, a name — so the field reads all of them and says plainly what ArNS needs:
 * a 43-character Arweave id (a "CID" elsewhere; on Arweave, the id of an upload or a manifest).
 */
export type TargetInput =
  | { kind: 'empty' }
  | { kind: 'id'; id: string; from: 'id' | 'url' | 'ar' }
  | { kind: 'name'; name: string; undername?: string }
  | { kind: 'ipfs'; note: string }
  | { kind: 'invalid'; note: string };

export const TARGET_HELP =
  'The Target ID is the 43-character Arweave id of an upload — other tools call this a CID. Point at a site\'s manifest id to serve a folder (index.html at the root), or at one file\'s id. Paste an id, an ar:// link or any gateway link; or upload here and it fills itself.';

const ID_RE = /^[A-Za-z0-9_-]{43}$/;
const IPFS_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;
const NAME_RE = /^[a-z0-9-]{1,51}$/;

export function readTargetInput(raw: string): TargetInput {
  const v = raw.trim();
  if (!v) return { kind: 'empty' };
  if (ID_RE.test(v)) return { kind: 'id', id: v, from: 'id' };
  const ipfs = v.replace(/^ipfs:\/\//i, '').replace(/^https?:\/\/[^/]+\/ipfs\//i, '').split(/[/?#]/)[0];
  if (IPFS_RE.test(ipfs) || /^ipfs:\/\//i.test(v) || /\/ipfs\//i.test(v)) {
    return { kind: 'ipfs', note: 'That is an IPFS CID. ArNS serves Arweave, not IPFS — upload the same files here and the Arweave id fills in.' };
  }
  const ar = /^ar:\/\/([^/?#]+)/i.exec(v);
  if (ar) {
    if (ID_RE.test(ar[1])) return { kind: 'id', id: ar[1], from: 'ar' };
    return nameInput(ar[1].toLowerCase()) ?? { kind: 'invalid', note: 'Not an Arweave id or an ArNS name.' };
  }
  let url: URL | null = null;
  try { url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { url = null; }
  if (url && url.hostname.includes('.')) {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = (parts[0] === 'raw' ? parts[1] : parts[0]) ?? '';
    if (ID_RE.test(id)) return { kind: 'id', id, from: 'url' };
    if (!parts.length) {
      const label = url.hostname.split('.')[0].toLowerCase();
      if (url.hostname.split('.').length >= 3) { const n = nameInput(label); if (n) return n; }
    }
  }
  if (NAME_RE.test(v)) return { kind: 'invalid', note: 'Needs 43 characters. To copy what a name serves, paste ar://' + v + '.' };
  return { kind: 'invalid', note: 'Needs exactly 43 base64url characters (A–Z a–z 0–9 - _).' };
}

function nameInput(label: string): TargetInput | null {
  const [under, base] = label.includes('_') ? [label.slice(0, label.lastIndexOf('_')), label.slice(label.lastIndexOf('_') + 1)] : [undefined, label];
  if (!NAME_RE.test(base) || (under !== undefined && !/^[a-z0-9-]{1,61}$/.test(under))) return null;
  return under ? { kind: 'name', name: base, undername: under } : { kind: 'name', name: base };
}

/** What an id serves, read from a gateway: enough to see it is the right thing before pointing. */
export interface TargetDetails {
  readonly state: 'found' | 'pending' | 'unknown';
  readonly contentType?: string;
  readonly bytes?: number;
  readonly manifest?: { readonly paths: number; readonly index?: string };
}

export const DETAILS_GATEWAY = 'https://turbo-gateway.com';
const MANIFEST_TYPE = 'application/x.arweave-manifest+json';

export async function inspectTarget(id: string, fetchImpl: typeof fetch = fetch): Promise<TargetDetails> {
  try {
    const res = await fetchImpl(`${DETAILS_GATEWAY}/raw/${id}`, { method: 'HEAD' });
    if (res.status === 404) return { state: 'pending' };
    if (!res.ok) return { state: 'unknown' };
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim() || undefined;
    const len = Number(res.headers.get('content-length'));
    const bytes = Number.isFinite(len) && len >= 0 ? len : undefined;
    if (contentType !== MANIFEST_TYPE) return { state: 'found', contentType, bytes };
    const m = (await (await fetchImpl(`${DETAILS_GATEWAY}/raw/${id}`)).json()) as { paths?: Record<string, unknown>; index?: { path?: string } };
    return { state: 'found', contentType, bytes, manifest: { paths: Object.keys(m.paths ?? {}).length, ...(m.index?.path ? { index: m.index.path } : {}) } };
  } catch {
    return { state: 'unknown' };
  }
}

/** One plain line for the details. */
export function describeDetails(d: TargetDetails): string {
  if (d.state === 'pending') return 'Not on the gateways yet — fine right after an upload; it appears within minutes.';
  if (d.state === 'unknown') return 'Could not read it from a gateway just now.';
  const size = d.bytes === undefined ? '' : d.bytes < 1024 ? ` · ${d.bytes} B` : ` · ${(d.bytes / 1024).toFixed(1)} KiB`;
  if (d.manifest) return `A site: ${d.manifest.paths} file${d.manifest.paths === 1 ? '' : 's'}${d.manifest.index ? `, opens ${d.manifest.index}` : ', no index page'}${size}`;
  return `One file: ${d.contentType ?? 'unknown type'}${size}`;
}

/** The id a name (or undername) serves now, from the header every ar.io gateway sets. */
export async function resolveNameTarget(name: string, undername: string | undefined, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const p = await probeGateway(gatewayUrl(name, 'ar.io', undername), undefined, fetchImpl);
  return p.resolvedId && ID_RE.test(p.resolvedId) ? p.resolvedId : null;
}
