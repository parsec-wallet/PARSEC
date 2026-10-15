// Importer — any published page → an editable PageDoc. Three paths, best first:
//   1. our own page: the embedded <script type="application/json" id="parsec-page"> loads exactly;
//   2. an ar.io Pages page (or any page carrying a JSON blob with `blocks`): mapped field by field;
//   3. anything else: extracted — title, description, og:image, favicon, first h1 → display name,
//      first paragraph → tagline, every link → a link block, h2/h3 → headings, img → images.
// Nothing is locked: every field it fills stays editable.
//
// The parsing core is pure and takes a SimplePage (already-parsed simple data). The app builds one
// with DOMParser (simplifyWithDom); tests and environments without a DOM use the regex fallback
// (simplifyHtml), which reads the same things from the markup.

import {
  BLOCK_TYPES,
  SOCIAL_PLATFORMS,
  TEMPLATES,
  blankDoc,
  isHex6,
  normalizeDoc,
  themeFromTemplate,
  type Block,
  type BlockType,
  type PageDoc,
  type SocialPlatform,
} from './model';
import { PAGE_JSON_ID } from './render';

export type SimpleNode =
  | { kind: 'a'; href: string; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'img'; src: string; alt: string }
  | { kind: 'p'; text: string };

export interface SimplePage {
  title: string;
  /** meta name/property (lowercased) → content. */
  metas: Record<string, string>;
  /** <link rel="icon"> href. */
  icon: string;
  /** Body content in document order (scripts and styles removed). */
  nodes: SimpleNode[];
  /** Every <script type="application/json"> (and ld+json) with its id. */
  jsonScripts: { id: string; text: string }[];
}

export type ImportSource = 'parsec' | 'ario-pages' | 'extracted';

export interface ImportResult {
  doc: PageDoc;
  source: ImportSource;
  /** One line per thing found, for the LOAD step to show. */
  notes: string[];
}

export interface ImportOptions {
  pageId: string;
  name: string;
  extension: string;
  /** The manifest the HTML came from: relative path → id, so relative links and images resolve. */
  paths?: Readonly<Record<string, string>>;
}

// ── The regex fallback ───────────────────────────────────────────────────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function safeChar(n: number): string {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** Read a page with regular expressions: no DOM needed. Good enough for well-formed pages. */
export function simplifyHtml(html: string): SimplePage {
  const jsonScripts: SimplePage['jsonScripts'] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const a = attrs(m[1]);
    if (/json/i.test(a.type ?? '')) jsonScripts.push({ id: a.id ?? '', text: m[2] });
  }
  const title = textOf(/<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? '');
  const metas: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? '').toLowerCase();
    if (key && a.content !== undefined && !(key in metas)) metas[key] = a.content;
  }
  let icon = '';
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (/\bicon\b/i.test(a.rel ?? '') && a.href) { icon = a.href; break; }
  }
  const body = (/<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)?.[1] ?? html)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const found: { at: number; node: SimpleNode }[] = [];
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    found.push({ at: m.index ?? 0, node: { kind: 'a', href: attrs(m[1]).href ?? '', text: textOf(m[2]) } });
  }
  for (const m of body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    found.push({ at: m.index ?? 0, node: { kind: 'h', level: Number(m[1]), text: textOf(m[2]) } });
  }
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    found.push({ at: m.index ?? 0, node: { kind: 'img', src: a.src ?? '', alt: a.alt ?? '' } });
  }
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)) {
    found.push({ at: m.index ?? 0, node: { kind: 'p', text: textOf(m[1]) } });
  }
  found.sort((x, y) => x.at - y.at);
  return { title, metas, icon, nodes: found.map((f) => f.node), jsonScripts };
}

/** The same SimplePage, read by the browser's own parser (the app's path). Never executes scripts. */
export function simplifyWithDom(html: string): SimplePage {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const jsonScripts = Array.from(d.querySelectorAll('script')).filter((s) => /json/i.test(s.type)).map((s) => ({ id: s.id, text: s.textContent ?? '' }));
  const metas: Record<string, string> = {};
  for (const m of Array.from(d.querySelectorAll('meta'))) {
    const key = (m.getAttribute('property') ?? m.getAttribute('name') ?? '').toLowerCase();
    const content = m.getAttribute('content');
    if (key && content !== null && !(key in metas)) metas[key] = content;
  }
  const icon = Array.from(d.querySelectorAll('link')).find((l) => /\bicon\b/i.test(l.rel))?.getAttribute('href') ?? '';
  for (const s of Array.from(d.querySelectorAll('script,style,noscript,template'))) s.remove();
  const nodes: SimpleNode[] = [];
  const text = (e: Element): string => (e.textContent ?? '').replace(/[ \t\r\f\v]+/g, ' ').trim();
  for (const e of Array.from(d.body?.querySelectorAll('a,h1,h2,h3,h4,h5,h6,img,p') ?? [])) {
    const tag = e.tagName.toLowerCase();
    if (tag === 'a') nodes.push({ kind: 'a', href: e.getAttribute('href') ?? '', text: text(e) });
    else if (tag === 'img') nodes.push({ kind: 'img', src: e.getAttribute('src') ?? '', alt: e.getAttribute('alt') ?? '' });
    else if (tag === 'p') nodes.push({ kind: 'p', text: text(e) });
    else nodes.push({ kind: 'h', level: Number(tag[1]), text: text(e) });
  }
  return { title: (d.title ?? '').trim(), metas, icon, nodes, jsonScripts };
}

// ── The pure core ────────────────────────────────────────────────────────────

/** A relative path from the page's own manifest → ar://<id>; an absolute URL unchanged; else ''. */
export function absolutize(url: string, paths?: Readonly<Record<string, string>>): string {
  const v = url.trim();
  if (!v || v.startsWith('#') || /^javascript:/i.test(v)) return '';
  if (/^(https?:|ar:|mailto:|bitcoin:|litecoin:|ethereum:|solana:|algorand:)/i.test(v)) return v;
  if (/^data:/i.test(v)) return '';
  const p = v.replace(/^\.?\//, '').split(/[?#]/)[0];
  const id = paths?.[p];
  return id ? `ar://${id}` : '';
}

/** The emoji drawn in a favicon data URI, if the favicon is one. */
export function emojiFromFavicon(href: string): string {
  if (!/^data:image\/svg\+xml/i.test(href)) return '';
  let svg = href.slice(href.indexOf(',') + 1);
  try { svg = decodeURIComponent(svg); } catch { /* keep raw */ }
  const t = /<text\b[^>]*>([\s\S]{1,16}?)<\/text>/i.exec(svg)?.[1] ?? '';
  return decodeEntities(t).trim();
}

/** Our own page: the embedded document, with renderer-owned relative files resolved to ids. */
function fromParsecJson(text: string, opts: ImportOptions): PageDoc | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  const doc = normalizeDoc(parsed);
  if (!doc) return null;
  // An uploaded avatar lives in the old manifest; on re-import, point at it by id.
  const av = doc.profile.avatar;
  if (av && av !== 'autogen' && !/^(ar|https?):/i.test(av)) doc.profile.avatar = absolutize(av, opts.paths);
  if (!doc.pageId) doc.pageId = opts.pageId;
  return doc;
}

function pick(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim();
  return '';
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Find the first object (depth ≤ 4) that has a `blocks` array — how page builders store a page. */
function findPageObject(v: unknown, depth = 0): Record<string, unknown> | null {
  const o = obj(v);
  if (!o || depth > 4) return null;
  if (Array.isArray(o.blocks)) return o;
  for (const k of Object.keys(o)) {
    const hit = findPageObject(o[k], depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** An ar.io Pages (or similar) JSON page, mapped onto ours. Unknown block types are skipped. */
export function fromForeignJson(v: unknown, opts: ImportOptions): PageDoc | null {
  const page = findPageObject(v);
  if (!page) return null;
  const profile = obj(page.profile) ?? page;
  const theme = obj(page.theme) ?? {};
  const settings = obj(page.settings) ?? obj(page.seo) ?? {};
  const tplName = pick(theme, 'template', 'preset', 'name').toLowerCase();
  const tpl = TEMPLATES.find((t) => tplName && (t.id === tplName || t.label.toLowerCase() === tplName || tplName.includes(t.id)));
  const doc = blankDoc({ pageId: opts.pageId, name: opts.name, extension: opts.extension, template: tpl?.id ?? 'minimal' });
  const accent = pick(theme, 'accent', 'accentColor', 'accentColour');
  doc.theme = { ...themeFromTemplate(doc.theme.template), ...(isHex6(accent) ? { accent: accent.toLowerCase() } : {}) };
  doc.profile = {
    displayName: pick(profile, 'displayName', 'name', 'title'),
    tagline: pick(profile, 'tagline', 'headline', 'subtitle'),
    intro: pick(profile, 'intro', 'bio', 'description', 'about'),
    avatar: absolutize(pick(profile, 'avatar', 'avatarUrl', 'image', 'avatarSrc'), opts.paths),
  };
  doc.settings = {
    ...doc.settings,
    title: pick(settings, 'pageTitle', 'title'),
    seoTitle: pick(settings, 'seoTitle', 'metaTitle'),
    seoDescription: pick(settings, 'seoDescription', 'description', 'metaDescription'),
    favicon: pick(settings, 'favicon', 'faviconEmoji').slice(0, 16),
  };
  const known = new Set<string>(BLOCK_TYPES.map((b) => b.type));
  const blocks: Block[] = [];
  for (const raw of (page.blocks as unknown[]).slice(0, 200)) {
    const b = obj(raw);
    if (!b) continue;
    const data = obj(b.data) ?? obj(b.props) ?? b;
    const type = (pick(b, 'type', 'kind') || '').toLowerCase().replace(/[^a-z]/g, '');
    const t: BlockType | null = known.has(type) ? (type as BlockType)
      : type === 'socials' || type === 'socialrow' ? 'social'
        : type === 'verifybadge' || type === 'badge' ? 'verify'
          : type === 'paragraph' ? 'text' : null;
    if (!t) continue;
    const id = `b${blocks.length + 1}`;
    const url = absolutize(pick(data, 'url', 'href', 'link', 'src', 'verifyUrl'), opts.paths);
    switch (t) {
      case 'link': blocks.push({ id, type: t, label: pick(data, 'label', 'title', 'text'), url, icon: pick(data, 'icon', 'emoji').slice(0, 16), auto: 'import' }); break;
      case 'heading': blocks.push({ id, type: t, text: pick(data, 'text', 'title', 'label'), auto: 'import' }); break;
      case 'text': blocks.push({ id, type: t, text: pick(data, 'text', 'content', 'body'), auto: 'import' }); break;
      case 'image': blocks.push({ id, type: t, src: url, alt: pick(data, 'alt', 'altText'), auto: 'import' }); break;
      case 'embed': blocks.push({ id, type: t, url, title: pick(data, 'title', 'label'), auto: 'import' }); break;
      case 'divider': blocks.push({ id, type: t, auto: 'import' }); break;
      case 'button': blocks.push({ id, type: t, label: pick(data, 'label', 'text', 'title'), url, auto: 'import' }); break;
      case 'verify': blocks.push({ id, type: t, label: pick(data, 'label', 'text') || 'Verified', url, auto: 'import' }); break;
      case 'social': {
        const list = Array.isArray(data.links) ? data.links : Array.isArray(data.platforms) ? data.platforms : [];
        const links = list.map((l) => obj(l)).filter((l): l is Record<string, unknown> => !!l).map((l) => {
          const p = pick(l, 'platform', 'name', 'type').toLowerCase();
          return { platform: ((SOCIAL_PLATFORMS as readonly string[]).includes(p) ? p : p === 'twitter' ? 'x' : 'website') as SocialPlatform, url: absolutize(pick(l, 'url', 'href'), opts.paths) };
        });
        blocks.push({ id, type: t, links, auto: 'import' });
        break;
      }
    }
  }
  doc.blocks = blocks;
  return doc.profile.displayName || blocks.length ? doc : null;
}

/** Any page: what it says, as editable blocks. */
export function extractDoc(p: SimplePage, opts: ImportOptions): PageDoc {
  const doc = blankDoc({ pageId: opts.pageId, name: opts.name, extension: opts.extension, template: 'minimal' });
  const h1 = p.nodes.find((n): n is Extract<SimpleNode, { kind: 'h' }> => n.kind === 'h' && n.level === 1 && !!n.text);
  const firstP = p.nodes.find((n): n is Extract<SimpleNode, { kind: 'p' }> => n.kind === 'p' && n.text.length > 0);
  doc.profile.displayName = (h1?.text || p.metas['og:title'] || p.title).slice(0, 300);
  doc.profile.tagline = (firstP?.text ?? '').split('\n')[0].slice(0, 300);
  doc.settings.title = p.title.slice(0, 300);
  doc.settings.seoDescription = (p.metas.description || p.metas['og:description'] || '').slice(0, 600);
  doc.settings.ogImage = absolutize(p.metas['og:image'] ?? '', opts.paths);
  doc.settings.favicon = emojiFromFavicon(p.icon);
  const blocks: Block[] = [];
  const seen = new Set<string>();
  for (const n of p.nodes) {
    if (blocks.length >= 60) break;
    const id = `b${blocks.length + 1}`;
    if (n.kind === 'a') {
      const url = absolutize(n.href, opts.paths);
      if (!url || seen.has(url.toLowerCase())) continue;
      seen.add(url.toLowerCase());
      blocks.push({ id, type: 'link', label: n.text.slice(0, 300) || url, url, icon: '', auto: 'import' });
    } else if (n.kind === 'h' && (n.level === 2 || n.level === 3) && n.text) {
      blocks.push({ id, type: 'heading', text: n.text.slice(0, 300), auto: 'import' });
    } else if (n.kind === 'img') {
      const src = absolutize(n.src, opts.paths);
      if (src) blocks.push({ id, type: 'image', src, alt: n.alt.slice(0, 300), auto: 'import' });
    }
  }
  doc.blocks = blocks;
  return doc;
}

/** The whole import: our JSON, else a foreign page JSON, else extraction. */
export function importPage(page: SimplePage, opts: ImportOptions): ImportResult {
  const own = page.jsonScripts.find((s) => s.id === PAGE_JSON_ID);
  if (own) {
    const doc = fromParsecJson(own.text, opts);
    if (doc) return { doc, source: 'parsec', notes: [`A PARSEC page, version ${doc.version} — loaded exactly.`] };
  }
  for (const s of page.jsonScripts) {
    if (s.id === PAGE_JSON_ID) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(s.text); } catch { continue; }
    const doc = fromForeignJson(parsed, opts);
    if (doc) return { doc, source: 'ario-pages', notes: [`A page-builder page: ${doc.blocks.length} block${doc.blocks.length === 1 ? '' : 's'} read from its embedded data.`] };
  }
  const doc = extractDoc(page, opts);
  const links = doc.blocks.filter((b) => b.type === 'link').length;
  return {
    doc,
    source: 'extracted',
    notes: [`Read from the page's HTML: ${links} link${links === 1 ? '' : 's'}, ${doc.blocks.length - links} other block${doc.blocks.length - links === 1 ? '' : 's'}. Check every field — extraction is a best guess.`],
  };
}
