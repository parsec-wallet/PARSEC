import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { checkGateway, digestFromHeaders, rawUrl, sha256B64url, summarize, verifyUpload, type GatewayCheck } from '../verify';

const ID = 'x'.repeat(43);
const bytes = new TextEncoder().encode('permanent bytes');
const nodeDigest = createHash('sha256').update(bytes).digest('base64url');

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(fn: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => fn(url)));
}

describe('sha256B64url', () => {
  it('agrees with Node crypto (WebCrypto vs OpenSSL)', async () => {
    expect(await sha256B64url(bytes)).toBe(nodeDigest);
  });
});

describe('digestFromHeaders', () => {
  it('prefers x-ar-io-digest', () => {
    expect(digestFromHeaders(new Headers({ 'x-ar-io-digest': 'abc_-', 'content-digest': 'sha-256=:zzz=:' }))).toBe('abc_-');
  });
  it('converts an RFC 9530 content-digest to base64url', () => {
    // The live toon.ar.io pair from 2026-09-10: same hash, two encodings.
    const h = new Headers({ 'content-digest': 'sha-256=:HfPly1g+GhFMYGp6pI4ehiXTerycgZ2UOuwuyoSBLdo=:' });
    expect(digestFromHeaders(h)).toBe('HfPly1g-GhFMYGp6pI4ehiXTerycgZ2UOuwuyoSBLdo');
  });
  it('is undefined when the gateway claims nothing', () => {
    expect(digestFromHeaders(new Headers())).toBeUndefined();
  });
});

describe('rawUrl', () => {
  it('uses /raw/ and tolerates a trailing slash', () => {
    expect(rawUrl('https://turbo-gateway.com/', ID)).toBe(`https://turbo-gateway.com/raw/${ID}`);
  });
});

describe('checkGateway', () => {
  it('matches when the served bytes hash to the expected digest', async () => {
    stubFetch(() => new Response(bytes, { status: 200, headers: { 'x-ar-io-digest': nodeDigest, 'x-ar-io-verified': 'false' } }));
    const c = await checkGateway('https://gw', ID, nodeDigest);
    expect(c.state).toBe('match');
    expect(c.digest).toBe(nodeDigest);
    expect(c.headerDigest).toBe(nodeDigest);
    expect(c.gatewayVerified).toBe(false);
    expect(c.bytes).toBe(bytes.length);
  });
  it('reports a mismatch even when the gateway claims the right digest', async () => {
    stubFetch(() => new Response(new TextEncoder().encode('tampered'), { status: 200, headers: { 'x-ar-io-digest': nodeDigest } }));
    const c = await checkGateway('https://gw', ID, nodeDigest);
    expect(c.state).toBe('mismatch');
    expect(c.headerDigest).toBe(nodeDigest);
  });
  it('treats 404 as pending, not failure', async () => {
    stubFetch(() => new Response('not found', { status: 404 }));
    expect((await checkGateway('https://gw', ID, nodeDigest)).state).toBe('pending');
  });
  it('treats 5xx and network errors as unknown', async () => {
    stubFetch(() => new Response('bad gateway', { status: 502 }));
    expect((await checkGateway('https://gw', ID, nodeDigest)).state).toBe('unknown');
    stubFetch(() => { throw new TypeError('Failed to fetch'); });
    const c = await checkGateway('https://gw', ID, nodeDigest);
    expect(c.state).toBe('unknown');
    expect(c.error).toMatch(/Failed to fetch/);
  });
});

describe('verifyUpload', () => {
  it('asks every gateway and hashes our own bytes as the expectation', async () => {
    stubFetch((url) => url.startsWith('https://a/')
      ? new Response(bytes, { status: 200 })
      : new Response('', { status: 404 }));
    const checks = await verifyUpload(ID, bytes, ['https://a', 'https://b']);
    expect(checks.map((c) => c.state)).toEqual(['match', 'pending']);
    expect(summarize(checks)).toBe('verified');
  });
});

describe('summarize', () => {
  const c = (state: GatewayCheck['state']): GatewayCheck => ({ gateway: 'g', url: 'u', state });
  it('lets a single mismatch win over any number of matches', () => {
    expect(summarize([c('match'), c('match'), c('mismatch')])).toBe('mismatch');
  });
  it('orders verified > pending > unknown', () => {
    expect(summarize([c('pending'), c('match')])).toBe('verified');
    expect(summarize([c('unknown'), c('pending')])).toBe('pending');
    expect(summarize([c('unknown')])).toBe('unknown');
    expect(summarize([])).toBe('unknown');
  });
});
