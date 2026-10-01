import { describe, it, expect } from 'vitest';
import {
  ARIO_PLACEHOLDER_TARGET,
  clampTtl,
  describeTarget,
  gatewayUrl,
  identityDiff,
  isArweaveId,
  parseKeywords,
  probeGateway,
  recordUrls,
  truncId,
  validateAddressFor,
  validateUndername,
} from '../controller-model';

const DELTAVERSE_OWNER = 'Dhma3UDUUJGZDKeGAXKi3MjjSQgnQiUbmB47sufymvMg';

describe('name controller model', () => {
  it('recognises Arweave ids and the ar.io placeholder', () => {
    expect(isArweaveId(ARIO_PLACEHOLDER_TARGET)).toBe(true);
    expect(isArweaveId('too-short')).toBe(false);
    expect(isArweaveId(ARIO_PLACEHOLDER_TARGET + 'x')).toBe(false);
    expect(describeTarget(ARIO_PLACEHOLDER_TARGET)).toEqual({ stamp: 'ar.io placeholder', tone: 'warn' });
    expect(describeTarget(undefined).tone).toBe('alert');
    expect(describeTarget('AnYvLJTWcG9lr2Ll5MwYWZR2o5uTE39WbpYB0zCxwKM').tone).toBe('done');
  });

  it('validates addresses per namespace chain', () => {
    expect(validateAddressFor('solana', DELTAVERSE_OWNER).ok).toBe(true);
    expect(validateAddressFor('solana', ARIO_PLACEHOLDER_TARGET).ok).toBe(false); // base64url, not base58
    expect(validateAddressFor('arweave-hd', ARIO_PLACEHOLDER_TARGET).ok).toBe(true);
    expect(validateAddressFor('arweave-hd', DELTAVERSE_OWNER).ok).toBe(false);
    expect(validateAddressFor('solana', '').reason).toBe('Enter an address');
  });

  it('enforces undername rules', () => {
    expect(validateUndername(' Docs ')).toEqual({ ok: true, value: 'docs' });
    expect(validateUndername('api-v2').ok).toBe(true);
    expect(validateUndername('@').ok).toBe(false);
    expect(validateUndername('-lead').ok).toBe(false);
    expect(validateUndername('trail-').ok).toBe(false);
    expect(validateUndername('under_score').ok).toBe(false);
    expect(validateUndername('a'.repeat(62)).ok).toBe(false);
  });

  it('clamps TTL to the ar.io range', () => {
    expect(clampTtl(10)).toBe(60);
    expect(clampTtl(900)).toBe(900);
    expect(clampTtl(1e9)).toBe(86_400);
    expect(clampTtl(NaN)).toBe(900);
  });

  it('builds gateway URLs for root and undernames', () => {
    expect(gatewayUrl('deltaverse', 'ar.io')).toBe('https://deltaverse.ar.io');
    expect(gatewayUrl('deltaverse', 'ar.io', '@')).toBe('https://deltaverse.ar.io');
    expect(gatewayUrl('deltaverse', 'arweave.net', 'docs')).toBe('https://docs_deltaverse.arweave.net');
    const urls = recordUrls('deltaverse', undefined, 'gw.bankon.pythai.net');
    expect(urls[0]).toBe('https://deltaverse.gw.bankon.pythai.net');
    expect(urls).toContain('https://deltaverse.ar.io');
  });

  it('diffs identity fields so only changes are written', () => {
    const cur = { nickname: 'deltaverse', ticker: 'aos', description: '', keywords: [], logo: 'AnYvLJTWcG9lr2Ll5MwYWZR2o5uTE39WbpYB0zCxwKM' };
    const next = { ...cur, ticker: 'DV', keywords: parseKeywords('sovereign, identity,, sovereign') };
    expect(identityDiff(cur, next)).toEqual({ ticker: 'DV', keywords: ['sovereign', 'identity'] });
    expect(identityDiff(cur, { ...cur })).toEqual({});
  });

  it('probes a gateway through the x-arns-resolved-id header', async () => {
    const fake = (async (_url: string) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-arns-resolved-id': ARIO_PLACEHOLDER_TARGET }),
    })) as unknown as typeof fetch;
    const p = await probeGateway('https://deltaverse.ar.io', ARIO_PLACEHOLDER_TARGET, fake);
    expect(p).toMatchObject({ ok: true, status: 200, resolvedId: ARIO_PLACEHOLDER_TARGET, matches: true });
    const miss = (async () => ({ ok: false, status: 404, headers: new Headers() })) as unknown as typeof fetch;
    const m = await probeGateway('https://deltaverse.ar.io', ARIO_PLACEHOLDER_TARGET, miss);
    expect(m.ok).toBe(false);
    expect(m.resolvedId).toBeUndefined();
    expect(m.matches).toBeUndefined();
    const boom = (async () => { throw new Error('blocked by CSP'); }) as unknown as typeof fetch;
    expect((await probeGateway('https://x', undefined, boom)).error).toContain('CSP');
  });

  it('truncates ids for display', () => {
    expect(truncId(DELTAVERSE_OWNER)).toBe('Dhma3UDU…fymvMg');
    expect(truncId(undefined)).toBe('—');
    expect(truncId('short')).toBe('short');
  });
});
