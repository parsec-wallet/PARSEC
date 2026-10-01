import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FREE_LIMIT_FALLBACK_BYTES,
  TurboError,
  getTurboInfo,
  getTurboPriceWinc,
  planUpload,
  postDataItem,
  runUpload,
  type TurboReceipt,
  type UploadSigner,
} from '../turbo';
import { estimateDataItemSize } from '../ans104';
import { MANIFEST_CONTENT_TYPE, encodeManifest, buildPathManifest } from '../manifest';

afterEach(() => { vi.unstubAllGlobals(); });

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const file = (path: string, body: string, contentType = 'text/html') => ({ path, bytes: enc(body), contentType });

describe('getTurboInfo', () => {
  it('reads the live free limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ freeUploadLimitBytes: 107520, gateway: 'https://turbo-gateway.com' }))));
    expect(await getTurboInfo()).toEqual({ freeUploadLimitBytes: 107520, gateway: 'https://turbo-gateway.com', live: true });
  });
  it('falls back, and says so, when the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const info = await getTurboInfo();
    expect(info.live).toBe(false);
    expect(info.freeUploadLimitBytes).toBe(FREE_LIMIT_FALLBACK_BYTES);
  });
});

describe('getTurboPriceWinc', () => {
  it('returns an exact bigint from the price endpoint', async () => {
    const f = vi.fn(async () => new Response('{"winc":"2600641213","adjustments":[]}'));
    vi.stubGlobal('fetch', f);
    expect(await getTurboPriceWinc(204800)).toBe(2600641213n);
    expect(f).toHaveBeenCalledWith('https://payment.ardrive.io/v1/price/bytes/204800');
  });
  it('refuses malformed prices and bad byte counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"winc":1.5}')));
    await expect(getTurboPriceWinc(10)).rejects.toThrow(/malformed/);
    await expect(getTurboPriceWinc(-1)).rejects.toThrow(/non-negative/);
    await expect(getTurboPriceWinc(1.5)).rejects.toThrow(/non-negative/);
  });
});

describe('postDataItem', () => {
  it('POSTs the raw item as octet-stream to /v1/tx/arweave and parses the receipt', async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({
      id: 'I'.repeat(43), owner: 'o', winc: '0', dataCaches: ['arweave.net'], fastFinalityIndexes: ['arweave.net'], deadlineHeight: 1,
    }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const raw = new Uint8Array([1, 2, 3]);
    const r = await postDataItem(raw);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://upload.ardrive.io/v1/tx/arweave');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/octet-stream');
    expect(init.body).toBe(raw);
    expect(r.id).toBe('I'.repeat(43));
    expect(r.dataCaches).toEqual(['arweave.net']);
  });
  it('turns 402 into a plain explanation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Insufficient balance', { status: 402 })));
    await expect(postDataItem(new Uint8Array(1))).rejects.toMatchObject({ name: 'TurboError', status: 402 });
  });
  it('rejects a response with no id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await expect(postDataItem(new Uint8Array(1))).rejects.toBeInstanceOf(TurboError);
  });
});

describe('planUpload', () => {
  it('plans a single file with no manifest and an exact size', () => {
    const p = planUpload([file('photo.png', 'x'.repeat(1000), 'image/png')], 107520);
    expect(p.manifest).toBeUndefined();
    expect(p.items[0].size).toBe(estimateDataItemSize({ dataLength: 1000, tags: [...p.items[0].tags] }));
    expect(p.allFree).toBe(true);
  });
  it('marks an item over the limit as paid', () => {
    const p = planUpload([file('big.bin', 'x'.repeat(2000))], 1500);
    expect(p.items[0].free).toBe(false);
    expect(p.allFree).toBe(false);
  });
  it('adds a manifest for several files, with index and 404 fallback, sized exactly', () => {
    const files = [file('index.html', '<h1>hi</h1>'), file('404.html', 'nope'), file('app.css', 'a{}', 'text/css')];
    const p = planUpload(files, 107520);
    expect(p.manifest?.index).toBe('index.html');
    expect(p.manifest?.fallback).toBe('404.html');
    // The real manifest, built from real 43-char ids, has the same byte length as the planned one.
    const real = encodeManifest(buildPathManifest(files.map((f, i) => ({ path: f.path, id: String(i).padStart(43, 'q') })), { index: 'index.html', fallbackPath: '404.html' }));
    const tags = [{ name: 'Content-Type', value: MANIFEST_CONTENT_TYPE }, { name: 'App-Name', value: 'Parsec' }];
    expect(p.manifest?.size).toBe(estimateDataItemSize({ dataLength: enc(real).length, tags }));
    expect(p.totalBytes).toBe(p.items.reduce((n, i) => n + i.size, 0) + (p.manifest?.size ?? 0));
  });
  it('refuses an empty upload', () => {
    expect(() => planUpload([], 1)).toThrow(/Nothing/);
  });
});

describe('runUpload', () => {
  let n = 0;
  const idFor = (i: number): string => String(i).padStart(43, 'Z');
  const fakeSigner: UploadSigner = async (input) => {
    n += 1;
    const data = typeof input.data === 'string' ? enc(input.data) : input.data;
    return { raw: data, id: idFor(n), signature: '', owner: '' };
  };
  const echoPost = async (raw: Uint8Array): Promise<TurboReceipt> => ({ id: idFor(n), owner: '', winc: '0', dataCaches: [], fastFinalityIndexes: [], ...(raw.length < 0 ? {} : {}) });

  it('uploads files, then a manifest that points at their ids, and roots at the manifest', async () => {
    n = 0;
    const events: string[] = [];
    const plan = planUpload([file('index.html', 'home'), file('a.css', 'a{}', 'text/css')], 107520);
    const r = await runUpload(plan, fakeSigner, (e) => events.push(`${e.kind}:${e.path}`), echoPost);
    expect(r.items.map((i) => i.id)).toEqual([idFor(1), idFor(2)]);
    expect(r.rootId).toBe(idFor(3));
    const manifest = JSON.parse(new TextDecoder().decode(r.manifest!.bytes));
    expect(manifest.paths['index.html'].id).toBe(idFor(1));
    expect(manifest.paths['a.css'].id).toBe(idFor(2));
    expect(manifest.index).toEqual({ path: 'index.html' });
    expect(events).toEqual(['signing:index.html', 'uploaded:index.html', 'signing:a.css', 'uploaded:a.css', 'signing:(manifest)', 'uploaded:(manifest)']);
  });

  it('roots a single file at its own id', async () => {
    n = 0;
    const r = await runUpload(planUpload([file('note.txt', 'hi', 'text/plain')], 107520), fakeSigner, undefined, echoPost);
    expect(r.manifest).toBeUndefined();
    expect(r.rootId).toBe(idFor(1));
  });

  it('refuses a receipt whose id is not the id we signed', async () => {
    n = 0;
    const liar = async (): Promise<TurboReceipt> => ({ id: 'X'.repeat(43), owner: '', winc: '0', dataCaches: [], fastFinalityIndexes: [] });
    await expect(runUpload(planUpload([file('a.txt', 'a', 'text/plain')], 107520), fakeSigner, undefined, liar)).rejects.toThrow(/signed as/);
  });
});
