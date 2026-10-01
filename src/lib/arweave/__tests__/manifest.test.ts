import { describe, expect, it } from 'vitest';
import {
  MANIFEST_CONTENT_TYPE,
  buildPathManifest,
  encodeManifest,
  guessContentType,
  normalizeManifestPath,
  stripCommonRoot,
} from '../manifest';

const A = 'A'.repeat(43);
const B = 'B'.repeat(42) + '_';
const C = 'c'.repeat(42) + '-';

describe('normalizeManifestPath', () => {
  it('uses forward slashes and drops leading ./ and /', () => {
    expect(normalizeManifestPath('./assets\\app.js')).toBe('assets/app.js');
    expect(normalizeManifestPath('/index.html')).toBe('index.html');
    expect(normalizeManifestPath('a//b/./c.css')).toBe('a/b/c.css');
  });
  it('refuses to climb out of the site root', () => {
    expect(() => normalizeManifestPath('../secret.txt')).toThrow(/\.\./);
    expect(() => normalizeManifestPath('a/../../b')).toThrow(/\.\./);
  });
  it('refuses an empty path', () => {
    expect(() => normalizeManifestPath('./')).toThrow(/Empty/);
  });
});

describe('stripCommonRoot', () => {
  it('drops the folder name a directory picker prepends', () => {
    expect(stripCommonRoot(['site/index.html', 'site/css/a.css'])).toEqual(['index.html', 'css/a.css']);
  });
  it('leaves mixed roots and bare files alone', () => {
    expect(stripCommonRoot(['a/index.html', 'b/x.css'])).toEqual(['a/index.html', 'b/x.css']);
    expect(stripCommonRoot(['index.html'])).toEqual(['index.html']);
  });
});

describe('buildPathManifest', () => {
  it('builds an arweave/paths 0.2.0 manifest with index defaulting to index.html', () => {
    const m = buildPathManifest([{ path: 'index.html', id: A }, { path: 'css/app.css', id: B }]);
    expect(m.manifest).toBe('arweave/paths');
    expect(m.version).toBe('0.2.0');
    expect(m.index).toEqual({ path: 'index.html' });
    expect(m.paths).toEqual({ 'css/app.css': { id: B }, 'index.html': { id: A } });
    expect(m.fallback).toBeUndefined();
  });
  it('sets fallback to the named file id', () => {
    const m = buildPathManifest([{ path: 'index.html', id: A }, { path: '404.html', id: C }], { fallbackPath: '404.html' });
    expect(m.fallback).toEqual({ id: C });
  });
  it('omits index when there is no index.html and none was named', () => {
    expect(buildPathManifest([{ path: 'readme.txt', id: A }]).index).toBeUndefined();
  });
  it('rejects bad ids, duplicates, and an index or fallback that was not uploaded', () => {
    expect(() => buildPathManifest([{ path: 'a', id: 'short' }])).toThrow(/Not an Arweave id/);
    expect(() => buildPathManifest([{ path: 'a', id: A }, { path: './a', id: B }])).toThrow(/Duplicate/);
    expect(() => buildPathManifest([{ path: 'a', id: A }], { index: 'index.html' })).toThrow(/Index/);
    expect(() => buildPathManifest([{ path: 'a', id: A }], { fallbackPath: '404.html' })).toThrow(/Fallback/);
    expect(() => buildPathManifest([])).toThrow(/at least one/);
  });
  it('encodes deterministically regardless of input order', () => {
    const one = encodeManifest(buildPathManifest([{ path: 'index.html', id: A }, { path: 'b.css', id: B }]));
    const two = encodeManifest(buildPathManifest([{ path: 'b.css', id: B }, { path: 'index.html', id: A }]));
    expect(one).toBe(two);
    expect(JSON.parse(one).paths['b.css'].id).toBe(B);
  });
});

describe('guessContentType', () => {
  it('maps common web extensions, case-insensitively', () => {
    expect(guessContentType('index.HTML')).toBe('text/html');
    expect(guessContentType('app.mjs')).toBe('text/javascript');
    expect(guessContentType('logo.svg')).toBe('image/svg+xml');
  });
  it('falls back to the browser type, then octet-stream', () => {
    expect(guessContentType('data.bin', 'application/x-custom')).toBe('application/x-custom');
    expect(guessContentType('data.bin')).toBe('application/octet-stream');
  });
  it('names the manifest content type gateways expect', () => {
    expect(MANIFEST_CONTENT_TYPE).toBe('application/x.arweave-manifest+json');
  });
});
