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
