// Verified reads — the idea behind ar.io Wayfinder's HashVerificationStrategy, rebuilt with no
// dependency. A gateway is a door, not an authority: fetch the bytes, hash them here, and compare
// against something already trusted — our own bytes right after an upload, or a digest from
// elsewhere. The gateway's own `x-ar-io-verified` flag is recorded but never trusted on its own.
//
// Checked live 2026-09-10:
//   - `x-ar-io-digest` is base64url(SHA-256(body)); `content-digest` carries the same hash in
//     RFC 9530 form (`sha-256=:<base64>:`). toon.ar.io: HfPly1g-GhFMYGp6pI4ehiXTerycgZ2UOuwuyoSBLdo
//     over 93,089 bytes, recomputed locally and equal.
//   - turbo-gateway.com serves /raw/<id> with that header and open CORS; ar.io's apex returns 404 on
//     /raw; permagate.io was answering 502. So an unreachable gateway is `unknown`, a 404 is
//     `pending` (not indexed yet), and neither is ever reported as a failed verification.

import { bytesToBase64url } from '../arweave/jwk';

export type VerifyState = 'match' | 'mismatch' | 'pending' | 'unknown';

export interface GatewayCheck {
  readonly gateway: string;
  readonly url: string;
  readonly state: VerifyState;
  readonly httpStatus?: number;
  /** base64url SHA-256 of the bytes this gateway returned, computed here. */
  readonly digest?: string;
  /** The digest the gateway claims (x-ar-io-digest, else content-digest). */
  readonly headerDigest?: string;
  /** The gateway's own `x-ar-io-verified` claim. Informational only. */
  readonly gatewayVerified?: boolean;
  readonly bytes?: number;
  readonly error?: string;
}

/** Gateways asked by default. Turbo's gateway first: it serves a fresh upload before indexing. */
export const VERIFY_GATEWAYS: readonly string[] = [
  'https://turbo-gateway.com',
  'https://arweave.net',
  'https://permagate.io',
];

export async function sha256B64url(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return bytesToBase64url(new Uint8Array(h));
}

/** The body digest a gateway claims, as base64url, or undefined when it sends none. */
export function digestFromHeaders(h: Headers): string | undefined {
  const x = h.get('x-ar-io-digest')?.trim();
  if (x) return x;
  const m = h.get('content-digest')?.match(/sha-256=:([A-Za-z0-9+/_=-]+):/i);
  return m ? m[1].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : undefined;
}

/** /raw/ skips manifest resolution, so a manifest id returns the manifest bytes we uploaded. */
export function rawUrl(gateway: string, id: string): string {
  return `${gateway.replace(/\/+$/, '')}/raw/${id}`;
}

/** Fetch `id` from one gateway and compare the hash of what it served with `expected`. */
export async function checkGateway(gateway: string, id: string, expected: string, timeoutMs = 20_000): Promise<GatewayCheck> {
  const url = rawUrl(gateway, id);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const claimed = digestFromHeaders(res.headers);
    const flag = res.headers.get('x-ar-io-verified');
    const extra = {
      ...(claimed !== undefined ? { headerDigest: claimed } : {}),
      ...(flag !== null ? { gatewayVerified: flag.trim() === 'true' } : {}),
    };
    if (res.status === 404) return { gateway, url, state: 'pending', httpStatus: 404, ...extra };
    if (!res.ok) return { gateway, url, state: 'unknown', httpStatus: res.status, error: `HTTP ${res.status}` };
    const body = new Uint8Array(await res.arrayBuffer());
    const digest = await sha256B64url(body);
    return {
      gateway, url, state: digest === expected ? 'match' : 'mismatch',
      httpStatus: res.status, digest, bytes: body.length, ...extra,
    };
  } catch (e) {
    const error = ctl.signal.aborted ? 'timed out' : e instanceof Error ? e.message : String(e);
    return { gateway, url, state: 'unknown', error };
  } finally {
    clearTimeout(timer);
  }
}

/** After an upload: do the gateways serve exactly the bytes we signed? */
export async function verifyUpload(
  id: string,
  localBytes: Uint8Array,
  gateways: readonly string[] = VERIFY_GATEWAYS,
): Promise<GatewayCheck[]> {
  const expected = await sha256B64url(localBytes);
  return Promise.all(gateways.map((g) => checkGateway(g, id, expected)));
}

export type VerifySummary = 'verified' | 'mismatch' | 'pending' | 'unknown';

/**
 * One word for a set of checks. A single mismatch wins — a gateway serving different bytes is the
 * one result that must never be averaged away. Otherwise one match is enough to call it verified.
 */
export function summarize(checks: readonly GatewayCheck[]): VerifySummary {
  if (checks.some((c) => c.state === 'mismatch')) return 'mismatch';
  if (checks.some((c) => c.state === 'match')) return 'verified';
  if (checks.some((c) => c.state === 'pending')) return 'pending';
  return 'unknown';
}
