// Arweave path manifests — how a folder of uploaded files becomes one addressable site.
//
// A manifest is a small JSON data item mapping relative paths to the ids of the files already on
// Arweave. Gateways resolve `/<manifestId>/css/app.css` through it, `index` is served at the root,
// and `fallback` (manifest version 0.2.0) answers any path the manifest does not list — the SPA /
// 404 page. Point an ArNS name or undername at the manifest id and the whole folder is live.
//
// Pure: no network, no signing. Upload the files first, then build the manifest from their ids.

export const MANIFEST_CONTENT_TYPE = 'application/x.arweave-manifest+json';

export interface ManifestEntry {
  /** Path relative to the site root, e.g. `index.html`, `assets/app.js`. */
  readonly path: string;
  /** 43-character id of the uploaded file. */
  readonly id: string;
}

export interface PathManifest {
  manifest: 'arweave/paths';
  version: '0.2.0';
  index?: { path: string };
  fallback?: { id: string };
  paths: Record<string, { id: string }>;
}

const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/;

/**
 * Normalize a file path for a manifest: forward slashes, no leading `./` or `/`, no empty
 * segments. Throws on `..` — a manifest path must never climb out of the site root.
 */
export function normalizeManifestPath(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0) throw new Error(`Empty manifest path: "${path}"`);
  if (segments.includes('..')) throw new Error(`Manifest path may not contain "..": "${path}"`);
  return segments.join('/');
}

/**
 * Strip the folder name a directory picker puts in front of every file (`site/index.html` →
 * `index.html`) when every path shares it. Leaves mixed roots alone.
 */
export function stripCommonRoot(paths: readonly string[]): string[] {
  const norm = paths.map(normalizeManifestPath);
  const first = norm[0]?.split('/')[0];
  const shared = first !== undefined && norm.length > 0
    && norm.every((p) => p.includes('/') && p.split('/')[0] === first);
  return shared ? norm.map((p) => p.slice(first.length + 1)) : norm;
}

export function buildPathManifest(
  entries: readonly ManifestEntry[],
  opts: { index?: string; fallbackPath?: string } = {},
): PathManifest {
  if (entries.length === 0) throw new Error('A manifest needs at least one file');
  const paths: Record<string, { id: string }> = {};
  for (const e of entries) {
    const p = normalizeManifestPath(e.path);
    if (!ARWEAVE_ID.test(e.id)) throw new Error(`Not an Arweave id for ${p}: "${e.id}"`);
    if (paths[p]) throw new Error(`Duplicate manifest path: ${p}`);
    paths[p] = { id: e.id };
  }

  const sorted: Record<string, { id: string }> = {};
  for (const k of Object.keys(paths).sort()) sorted[k] = paths[k];

  const manifest: PathManifest = { manifest: 'arweave/paths', version: '0.2.0', paths: sorted };

  const index = opts.index !== undefined ? normalizeManifestPath(opts.index) : (sorted['index.html'] ? 'index.html' : undefined);
  if (index !== undefined) {
    if (!sorted[index]) throw new Error(`Index "${index}" is not one of the uploaded files`);
    manifest.index = { path: index };
  }

  if (opts.fallbackPath !== undefined) {
    const fb = normalizeManifestPath(opts.fallbackPath);
    if (!sorted[fb]) throw new Error(`Fallback "${fb}" is not one of the uploaded files`);
    manifest.fallback = { id: sorted[fb].id };
  }
  return manifest;
}

/** Deterministic encoding — the manifest's bytes, and so its id, depend only on its content. */
export function encodeManifest(m: PathManifest): string {
  return JSON.stringify(m);
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', map: 'application/json', txt: 'text/plain', md: 'text/markdown',
  xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', pdf: 'application/pdf',
  wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', webmanifest: 'application/manifest+json',
};

/**
 * Content-Type for a path. Gateways serve a file with exactly the Content-Type tag it was
 * uploaded with, so this decides whether a browser renders the page or downloads it.
 */
export function guessContentType(path: string, browserType?: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return CONTENT_TYPES[ext] ?? (browserType && browserType.length > 0 ? browserType : 'application/octet-stream');
}
