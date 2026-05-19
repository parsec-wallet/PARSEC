// Arweave JWK helpers — parse, validate, derive 43-char base64url address.
// The address is SHA-256(base64url-decode(jwk.n)) → base64url. The same
// formula lives in src/lib/pouch/chains.ts, kept in sync here so the
// arweave/ module is self-contained.

export interface ArweaveJwk extends JsonWebKey {
  kty: 'RSA';
  n: string;
  e: string;
  d: string;
  p: string;
  q: string;
  dp: string;
  dq: string;
  qi: string;
}

const ADDRESS_LENGTH = 43;

/** Parse a JWK from a JSON string. Throws on malformed input. */
export function parseJwk(json: string): ArweaveJwk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Arweave key must be JWK JSON');
  }
  if (!isArweaveJwk(parsed)) {
    throw new Error('Invalid Arweave JWK (expected RSA private key with n, e, d, p, q, dp, dq, qi)');
  }
  return parsed;
}

/** Type-guarded shape check for an Arweave RSA private JWK. */
export function isArweaveJwk(v: unknown): v is ArweaveJwk {
  if (!v || typeof v !== 'object') return false;
  const j = v as Record<string, unknown>;
  return (
    j.kty === 'RSA' &&
    typeof j.n === 'string' && j.n.length > 0 &&
    typeof j.e === 'string' && j.e.length > 0 &&
    typeof j.d === 'string' && j.d.length > 0 &&
    typeof j.p === 'string' &&
    typeof j.q === 'string' &&
    typeof j.dp === 'string' &&
    typeof j.dq === 'string' &&
    typeof j.qi === 'string'
  );
}

/** Derive a 43-char base64url Arweave address from a JWK's public modulus. */
export async function addressFromJwk(jwk: ArweaveJwk | JsonWebKey): Promise<string> {
  if (!jwk.n) throw new Error('JWK missing public modulus n');
  const nBytes = base64urlToBytes(jwk.n);
  const hash = await crypto.subtle.digest('SHA-256', nBytes as unknown as BufferSource);
  return bytesToBase64url(new Uint8Array(hash));
}

/** Shape-check a 43-char base64url Arweave address. Does not verify a key. */
export function isArweaveAddress(s: string): boolean {
  return typeof s === 'string' && s.length === ADDRESS_LENGTH && /^[A-Za-z0-9_-]+$/.test(s);
}

// ── base64url helpers ─────────────────────────────────────────

export function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
