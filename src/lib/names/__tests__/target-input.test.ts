import { describe, expect, it } from 'vitest';
import { describeDetails, inspectTarget, readTargetInput, resolveNameTarget } from '../controller-model';

const ID = 'T9_V2HfiAq5qlLzObfyayj2-cjPujxpg25TRi4OZbe4';

describe('readTargetInput — whatever people paste', () => {
  it('a bare id, an ar:// id, and gateway links all give the id', () => {
    expect(readTargetInput(ID)).toEqual({ kind: 'id', id: ID, from: 'id' });
    expect(readTargetInput(` ar://${ID} `)).toEqual({ kind: 'id', id: ID, from: 'ar' });
    expect(readTargetInput(`https://arweave.net/${ID}`)).toEqual({ kind: 'id', id: ID, from: 'url' });
    expect(readTargetInput(`https://turbo-gateway.com/raw/${ID}`)).toEqual({ kind: 'id', id: ID, from: 'url' });
    expect(readTargetInput(`ar.io/${ID}/index.html`)).toEqual({ kind: 'id', id: ID, from: 'url' });
  });

  it('an IPFS CID is explained, never accepted', () => {
    for (const c of ['bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', 'ipfs://bafy123', 'https://ipfs.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG']) {
      const r = readTargetInput(c);
      expect(r.kind).toBe('ipfs');
    }
  });

  it('a name or undername is recognised, to resolve what it serves', () => {
    expect(readTargetInput('ar://spintrade')).toEqual({ kind: 'name', name: 'spintrade' });
    expect(readTargetInput('ar://tnt_spintrade')).toEqual({ kind: 'name', name: 'spintrade', undername: 'tnt' });
    expect(readTargetInput('https://tnt_spintrade.ar.io')).toEqual({ kind: 'name', name: 'spintrade', undername: 'tnt' });
  });

  it('anything else says what is needed', () => {
    expect(readTargetInput('spintrade').kind).toBe('invalid');
    expect(readTargetInput('abc').kind).toBe('invalid');
    expect(readTargetInput('').kind).toBe('empty');
  });
});

const res = (status: number, headers: Record<string, string> = {}, body = ''): Response => new Response(status === 200 ? body : null, { status, headers });

describe('inspectTarget — what an id serves', () => {
  it('one file', async () => {
    const d = await inspectTarget(ID, (async () => res(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': '7670' })) as typeof fetch);
    expect(d).toEqual({ state: 'found', contentType: 'text/html', bytes: 7670 });
    expect(describeDetails(d)).toBe('One file: text/html · 7.5 KiB');
  });

  it('a site, read from its manifest', async () => {
    const manifest = JSON.stringify({ manifest: 'arweave/paths', version: '0.2.0', index: { path: 'index.html' }, paths: { 'index.html': { id: ID }, 'logo.svg': { id: ID }, '404.html': { id: ID } } });
    const f = (async (_u: string, init?: RequestInit) => init?.method === 'HEAD'
      ? res(200, { 'content-type': 'application/x.arweave-manifest+json', 'content-length': String(manifest.length) })
      : res(200, { 'content-type': 'application/x.arweave-manifest+json' }, manifest)) as typeof fetch;
    const d = await inspectTarget(ID, f);
    expect(d.manifest).toEqual({ paths: 3, index: 'index.html' });
    expect(describeDetails(d)).toMatch(/^A site: 3 files, opens index.html/);
  });

  it('pending right after an upload; unknown when a gateway is down', async () => {
    expect((await inspectTarget(ID, (async () => res(404)) as typeof fetch)).state).toBe('pending');
    expect((await inspectTarget(ID, (async () => { throw new Error('offline'); }) as typeof fetch)).state).toBe('unknown');
  });

  it('a name resolves to the id its gateway header names', async () => {
    const f = (async () => res(200, { 'x-arns-resolved-id': ID })) as typeof fetch;
    expect(await resolveNameTarget('spintrade', 'tnt', f)).toBe(ID);
  });
});
