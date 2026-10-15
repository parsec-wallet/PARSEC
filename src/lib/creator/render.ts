// Render — PageDoc → the files that go up: one self-contained index.html, plus the generated avatar
// and social card when the page uses them. Pure and deterministic: the same document always gives
// the same bytes, so a plan's sizes are the upload's sizes.
//
// The generated page (not the app) may carry inline <style> and one tiny inline <script>; it loads
// no external script, font or stylesheet. The only URLs in it are the person's own links and images,
// and the document itself rides along as <script type="application/json" id="parsec-page"> so the
// page can be loaded back into the editor exactly.

import type { DataItemTag } from '../arweave/ans104';
import type { UploadFile } from '../arweave/turbo';
import { cardSvg, escapeXml, initials, sigilSvg } from './autogen';
import { readableOn } from './color';
import {
  FONTS,
  effectiveDescription,
  effectiveTitle,
  hostLabel,
  publicDoc,
  type Block,
  type PageDoc,
  type SocialPlatform,
} from './model';

export const RENDER_WITH = 'parsec-creator';
export const PAGE_JSON_ID = 'parsec-page';
/** Paths the renderer owns inside the page's manifest. */
export const AVATAR_SVG = 'avatar.svg';
export const CARD_SVG = 'card.svg';
export const CARD_PNG = 'card.png';
/** An uploaded avatar is stored under one of these, by type. */
export const AVATAR_UPLOAD_PATHS = ['avatar.webp', 'avatar.png', 'avatar.jpg'] as const;

const ID_RE = /^[A-Za-z0-9_-]{43}$/;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** URI schemes a link may use. Anything else (javascript:, data:, file:, …) is dropped. */
const SAFE_SCHEMES = ['https:', 'http:', 'mailto:', 'bitcoin:', 'litecoin:', 'ethereum:', 'solana:', 'algorand:'];

export interface ResolvedUrl {
  /** What goes in href/src. */
  href: string;
  /** For ar:// links: the ar target, so the page can rewrite it to whichever gateway serves it. */
  ar?: string;
}

/**
 * A person's URL → something safe to put in the page, or null. ar://<id> resolves to arweave.net,
 * ar://<name>[/path] to <name>.ar.io; relative paths are allowed only for the renderer's own files.
 */
export function resolveUrl(raw: string, ownPaths: readonly string[] = []): ResolvedUrl | null {
  const v = raw.trim();
  if (!v) return null;
  if (ownPaths.includes(v)) return { href: v };
  const ar = /^ar:\/\/([A-Za-z0-9_-]+)(\/[^\s]*)?$/i.exec(v);
  if (ar) {
    const [, head, rest = ''] = ar;
    if (ID_RE.test(head)) return { href: `https://arweave.net/${head}${rest}`, ar: `${head}${rest}` };
    const label = head.toLowerCase();
    if (!/^[a-z0-9_-]{1,113}$/.test(label)) return null;
    return { href: `https://${label}.ar.io${rest}`, ar: `${label}${rest}` };
  }
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) return { href: `mailto:${v}` };
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (!SAFE_SCHEMES.includes(u.protocol)) return null;
  return { href: v };
}

function attrUrl(r: ResolvedUrl): string {
  return `href="${escapeHtml(r.href)}"${r.ar ? ` data-ar="${escapeHtml(r.ar)}"` : ''}`;
}

/** Text with line breaks, as paragraphs. */
function paragraphs(text: string, cls: string): string {
  return text.trim().split(/\n\s*\n/).filter(Boolean)
    .map((p) => `<p class="${cls}">${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

const SOCIAL_LABELS: Readonly<Record<SocialPlatform, string>> = {
  x: 'X', github: 'GitHub', discord: 'Discord', telegram: 'Telegram', youtube: 'YouTube', instagram: 'Instagram',
  linkedin: 'LinkedIn', farcaster: 'Farcaster', mastodon: 'Mastodon', email: 'Email', website: 'Website',
};

function blockHtml(b: Block, own: readonly string[]): string {
  switch (b.type) {
    case 'link': {
      const r = resolveUrl(b.url, own);
      if (!r) return '';
      const label = b.label.trim() || b.url.trim();
      return `<a class="lnk" ${attrUrl(r)} rel="noopener">${b.icon ? `<span class="ic" aria-hidden="true">${escapeHtml(b.icon)}</span>` : ''}<span>${escapeHtml(label)}</span></a>`;
    }
    case 'heading': return b.text.trim() ? `<h2>${escapeHtml(b.text.trim())}</h2>` : '';
    case 'text': return b.text.trim() ? paragraphs(b.text, 'txt') : '';
    case 'image': {
      const r = resolveUrl(b.src, own);
      return r ? `<img class="img" src="${escapeHtml(r.href)}" alt="${escapeHtml(b.alt)}" loading="lazy">` : '';
    }
    case 'embed': {
      const r = resolveUrl(b.url, own);
      if (!r || !/^https:/.test(r.href)) return '';
      return `<div class="emb"><iframe src="${escapeHtml(r.href)}" title="${escapeHtml(b.title || 'Embedded content')}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" allowfullscreen></iframe></div>`;
    }
    case 'divider': return '<hr>';
    case 'social': {
      const items = b.links.map((l) => {
        const r = resolveUrl(l.platform === 'email' && l.url && !/^mailto:/i.test(l.url) ? `mailto:${l.url.trim()}` : l.url, own);
        return r ? `<a ${attrUrl(r)} rel="noopener me">${escapeHtml(SOCIAL_LABELS[l.platform])}</a>` : '';
      }).filter(Boolean);
      return items.length ? `<nav class="soc" aria-label="Elsewhere">${items.join('')}</nav>` : '';
    }
    case 'button': {
      const r = resolveUrl(b.url, own);
      return r && b.label.trim() ? `<a class="btn" ${attrUrl(r)} rel="noopener">${escapeHtml(b.label.trim())}</a>` : '';
    }
    case 'verify': {
      const r = resolveUrl(b.url, own);
      return r ? `<a class="ver" ${attrUrl(r)} rel="noopener"><span aria-hidden="true">✓</span> ${escapeHtml(b.label.trim() || 'Verified')}</a>` : '';
    }
  }
}

/** The page's favicon: its emoji, drawn in an SVG data URI. */
export function faviconHref(emoji: string): string {
  const e = escapeXml(emoji.trim() || '✦');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${e}</text></svg>`)}`;
}

/** The JSON embedded for re-import: `<` `>` `&` escaped, so no string in it can close the script. */
export function embedJson(doc: PageDoc): string {
  return JSON.stringify(publicDoc(doc)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * ar:// links point at ar.io by default; when the page is served from a gateway's subdomain, this
 * repoints them at that same gateway — whichever door the visitor came through.
 */
const GATEWAY_SCRIPT = '(function(){var h=location.hostname.split(".");if(h.length<3)return;var g=h.slice(1).join(".");'
  + 'var a=document.querySelectorAll("[data-ar]");for(var i=0;i<a.length;i++){var t=a[i].getAttribute("data-ar")||"";var p=t.split("/")[0];'
  + 'a[i].href=/^[A-Za-z0-9_-]{43}$/.test(p)?"https://"+g+"/"+t:"https://"+p+"."+g+t.slice(p.length);}})();';

function css(doc: PageDoc): string {
  const t = doc.theme;
  const bg = t.background.kind === 'gradient' ? `linear-gradient(160deg,${t.background.from},${t.background.to})` : t.background.from;
  const radius = t.buttonShape === 'pill' ? '999px' : t.buttonShape === 'rounded' ? '10px' : '0';
  const width = t.width === 'wide' ? '820px' : '560px';
  const onAccent = readableOn(t.accent);
  return [
    `:root{--bg:${t.background.from};--fg:${t.text};--ac:${t.accent};--on:${onAccent};--r:${radius};--w:${width}}`,
    '*{box-sizing:border-box}',
    `html{background:${t.background.from}}`,
    `body{margin:0;min-height:100vh;background:${bg};color:var(--fg);font-family:${FONTS[t.font].stack};line-height:1.5}`,
    `main{max-width:var(--w);margin:0 auto;padding:48px 20px 64px;display:flex;flex-direction:column;gap:14px}`,
    `header{display:flex;flex-direction:column;align-items:${t.align === 'left' ? 'flex-start' : 'center'};text-align:${t.align};gap:8px;margin-bottom:12px}`,
    '.av{width:112px;height:112px;border-radius:50%;object-fit:cover;display:grid;place-items:center;font-size:40px;font-weight:700;background:var(--ac);color:var(--on)}',
    'h1{margin:4px 0 0;font-size:2rem;line-height:1.2}',
    'h2{margin:18px 0 0;font-size:1.15rem}',
    '.tag{margin:0;font-size:1.05rem;opacity:.85}',
    '.intro,.txt{margin:0}',
    'a{color:var(--ac)}',
    '.lnk,.btn{display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 18px;border-radius:var(--r);text-decoration:none;font-weight:600}',
    '.lnk{border:2px solid var(--ac);color:var(--fg)}',
    '.lnk:hover,.lnk:focus-visible{background:var(--ac);color:var(--on)}',
    '.btn{background:var(--ac);color:var(--on)}',
    '.ic{font-size:1.2em}',
    '.img{width:100%;height:auto;border-radius:12px}',
    '.emb{position:relative;padding-top:56.25%}.emb iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px}',
    'hr{width:100%;border:0;border-top:1px solid var(--fg);opacity:.25;margin:10px 0}',
    '.soc{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 16px}',
    '.ver{align-self:center;display:inline-flex;gap:6px;padding:6px 12px;border-radius:999px;border:1px solid var(--ac);text-decoration:none;font-size:.9rem}',
    'footer{margin-top:28px;text-align:center;font-size:.8rem;opacity:.6}',
    'footer a{color:inherit}',
  ].join('');
}

export interface RenderOptions {
  /** The person's own avatar image, already resized (≤ 512 px) — used when doc.profile.avatar is its path. */
  avatarFile?: { path: string; bytes: Uint8Array; contentType: string };
  /** A PNG of the social card (social sites do not read SVG); when given, og:image points at it. */
  cardPng?: Uint8Array;
}

export interface RenderedPage {
  html: string;
  files: UploadFile[];
}

/** The tags on the page's index.html: what it is, which version, what made it — and the person's own. */
export function pageTags(doc: PageDoc): DataItemTag[] {
  const clamp = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);
  return [
    ...(doc.pageId ? [{ name: 'Page-Id', value: doc.pageId }] : []),
    { name: 'Page-Title', value: clamp(effectiveTitle(doc), 200) },
    { name: 'Page-Template', value: doc.theme.template },
    { name: 'Page-Version', value: String(doc.version) },
    { name: 'Render-With', value: RENDER_WITH },
    ...doc.settings.tags,
  ];
}

export function renderPage(doc: PageDoc, opts: RenderOptions = {}): RenderedPage {
  const enc = new TextEncoder();
  const host = hostLabel(doc.domain) || 'page';
  const avatarIsGen = doc.profile.avatar === 'autogen';
  const avatarUpload = opts.avatarFile && doc.profile.avatar === opts.avatarFile.path ? opts.avatarFile : undefined;
  const cardIsGen = doc.settings.ogImage === 'autogen';
  const own = [
    ...(avatarIsGen ? [AVATAR_SVG] : []),
    ...(avatarUpload ? [avatarUpload.path] : []),
    ...(cardIsGen ? [CARD_SVG, ...(opts.cardPng ? [CARD_PNG] : [])] : []),
  ];

  const title = effectiveTitle(doc);
  const desc = effectiveDescription(doc);
  const display = doc.profile.displayName.trim() || doc.settings.title.trim() || doc.domain.name;
  const avatar = resolveUrl(avatarIsGen ? AVATAR_SVG : doc.profile.avatar, own);
  const og = cardIsGen ? (opts.cardPng ? CARD_PNG : CARD_SVG) : resolveUrl(doc.settings.ogImage, own)?.href ?? '';

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    ...(desc ? [`<meta name="description" content="${escapeHtml(desc)}">`] : []),
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    ...(desc ? [`<meta property="og:description" content="${escapeHtml(desc)}">`] : []),
    '<meta property="og:type" content="website">',
    ...(og ? [`<meta property="og:image" content="${escapeHtml(og)}">`, '<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:image" content="${escapeHtml(og)}">`] : ['<meta name="twitter:card" content="summary">']),
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    ...(desc ? [`<meta name="twitter:description" content="${escapeHtml(desc)}">`] : []),
    `<meta name="generator" content="PARSEC creator · ${RENDER_WITH}">`,
    `<link rel="icon" href="${faviconHref(doc.settings.favicon)}">`,
    `<style>${css(doc)}</style>`,
    `<script type="application/json" id="${PAGE_JSON_ID}">${embedJson(doc)}</script>`,
  ];

  const avatarHtml = avatar
    ? `<img class="av" src="${escapeHtml(avatar.href)}" alt="${escapeHtml(display)}" width="112" height="112">`
    : `<div class="av" aria-hidden="true">${escapeHtml(initials(display))}</div>`;
  const body = [
    '<main>',
    '<header>',
    avatarHtml,
    `<h1>${escapeHtml(display)}</h1>`,
    ...(doc.profile.tagline.trim() ? [`<p class="tag">${escapeHtml(doc.profile.tagline.trim())}</p>`] : []),
    ...(doc.profile.intro.trim() ? [paragraphs(doc.profile.intro, 'intro')] : []),
    '</header>',
    ...doc.blocks.map((b) => blockHtml(b, own)).filter(Boolean),
    `<footer>ar://${escapeHtml(host)} · permanent page · v${doc.version}</footer>`,
    '</main>',
    `<script>${GATEWAY_SCRIPT}</script>`,
  ];

  const html = `<!doctype html>\n<html lang="en"><head>${head.join('')}</head><body>${body.join('')}</body></html>\n`;
  const idTag = doc.pageId ? [{ name: 'Page-Id', value: doc.pageId }] : [];
  const files: UploadFile[] = [{ path: 'index.html', bytes: enc.encode(html), contentType: 'text/html', tags: pageTags(doc) }];
  if (avatarIsGen) files.push({ path: AVATAR_SVG, bytes: enc.encode(sigilSvg(host, doc.theme.accent)), contentType: 'image/svg+xml', tags: idTag });
  if (avatarUpload) files.push({ path: avatarUpload.path, bytes: avatarUpload.bytes, contentType: avatarUpload.contentType, tags: idTag });
  if (cardIsGen) {
    files.push({ path: CARD_SVG, bytes: enc.encode(cardFor(doc)), contentType: 'image/svg+xml', tags: idTag });
    if (opts.cardPng) files.push({ path: CARD_PNG, bytes: opts.cardPng, contentType: 'image/png', tags: idTag });
  }
  return { html, files };
}

/** The social card for a document. */
export function cardFor(doc: PageDoc): string {
  const host = hostLabel(doc.domain) || 'page';
  return cardSvg({
    host,
    title: doc.profile.displayName || doc.settings.title || host,
    tagline: doc.profile.tagline,
    accent: doc.theme.accent,
    background: { from: doc.theme.background.from, to: doc.theme.background.kind === 'gradient' ? doc.theme.background.to : doc.theme.background.from },
    text: doc.theme.text,
    font: FONTS[doc.theme.font].stack,
  });
}
