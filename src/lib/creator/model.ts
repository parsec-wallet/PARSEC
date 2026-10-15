// creator.agent — the page document. One JSON shape describes a permanent page: who it is for
// (profile), what it says (blocks), how it looks (theme), how it is labelled (settings), where it is
// served (domain) and where it came from (version + previous ids). The renderer turns it into one
// self-contained index.html and embeds the same JSON in it, so any published page can be loaded
// back and edited exactly.
//
// Pure: no DOM, no store, no network. The view (views/permaweb-create.ts) owns all of that.

import type { DataItemTag } from '../arweave/ans104';

export const PAGE_SCHEMA = 'parsec-page/1';

// ── Templates ────────────────────────────────────────────────────────────────

export type TemplateId = 'minimal' | 'midnight' | 'aurora' | 'paper' | 'terminal' | 'classic' | 'modern' | 'professional';
export type FontId = 'system' | 'serif' | 'mono' | 'rounded' | 'humanist' | 'classic';
export type ButtonShape = 'pill' | 'rounded' | 'square';
export type HeaderAlign = 'center' | 'left';
export type PageWidth = 'standard' | 'wide';

export interface TemplateTokens {
  readonly id: TemplateId;
  readonly label: string;
  readonly note: string;
  /** Background: one colour, or a two-stop gradient. */
  readonly background: { readonly kind: 'solid' | 'gradient'; readonly from: string; readonly to: string };
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  /** Surface behind blocks (cards, buttons in outline). */
  readonly surface: string;
  readonly font: FontId;
  readonly buttonShape: ButtonShape;
  readonly favicon: string;
}

export const TEMPLATES: readonly TemplateTokens[] = [
  { id: 'minimal', label: 'Minimal', note: 'White, quiet, one accent', background: { kind: 'solid', from: '#ffffff', to: '#ffffff' }, text: '#111111', muted: '#5c5c5c', accent: '#111111', surface: '#f2f2f2', font: 'system', buttonShape: 'rounded', favicon: '✦' },
  { id: 'midnight', label: 'Midnight', note: 'Deep blue night', background: { kind: 'gradient', from: '#0b1020', to: '#18213f' }, text: '#e8ecf8', muted: '#9aa6c8', accent: '#7aa2ff', surface: '#1b2442', font: 'system', buttonShape: 'pill', favicon: '🌙' },
  { id: 'aurora', label: 'Aurora', note: 'Northern-light gradient', background: { kind: 'gradient', from: '#0f2027', to: '#2c5364' }, text: '#f0fff8', muted: '#b4d8cf', accent: '#5ef2c2', surface: '#1d3b47', font: 'rounded', buttonShape: 'pill', favicon: '🌌' },
  { id: 'paper', label: 'Paper', note: 'Warm paper, serif type', background: { kind: 'solid', from: '#f6f1e7', to: '#f6f1e7' }, text: '#2b2620', muted: '#6b6052', accent: '#a0522d', surface: '#ece4d4', font: 'serif', buttonShape: 'square', favicon: '📜' },
  { id: 'terminal', label: 'Terminal', note: 'Green on black, monospace', background: { kind: 'solid', from: '#000000', to: '#000000' }, text: '#33ff66', muted: '#1fa846', accent: '#33ff66', surface: '#0a140c', font: 'mono', buttonShape: 'square', favicon: '⌨️' },
  { id: 'classic', label: 'Classic-era internet', note: 'Grey, Times, blue links', background: { kind: 'solid', from: '#c0c0c0', to: '#c0c0c0' }, text: '#000000', muted: '#333333', accent: '#0000ee', surface: '#dcdcdc', font: 'classic', buttonShape: 'square', favicon: '💾' },
  { id: 'modern', label: 'Modern web', note: 'Soft indigo, pill buttons', background: { kind: 'gradient', from: '#ffffff', to: '#eef2ff' }, text: '#0f172a', muted: '#475569', accent: '#4f46e5', surface: '#e0e7ff', font: 'system', buttonShape: 'pill', favicon: '✨' },
  { id: 'professional', label: 'Professional', note: 'Clean, corporate blue', background: { kind: 'solid', from: '#ffffff', to: '#ffffff' }, text: '#1f2937', muted: '#4b5563', accent: '#0a66c2', surface: '#f3f4f6', font: 'humanist', buttonShape: 'rounded', favicon: '💼' },
];

export function templateById(id: string): TemplateTokens {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

/** System font stacks only: a permanent page loads nothing from anywhere else. */
export const FONTS: Readonly<Record<FontId, { label: string; stack: string }>> = {
  system: { label: 'System sans', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  serif: { label: 'Serif', stack: 'Georgia, Cambria, "Times New Roman", serif' },
  mono: { label: 'Monospace', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' },
  rounded: { label: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif' },
  humanist: { label: 'Humanist', stack: '"Segoe UI", "Helvetica Neue", "Noto Sans", Arial, sans-serif' },
  classic: { label: 'Times', stack: '"Times New Roman", Times, serif' },
};

// ── Blocks ───────────────────────────────────────────────────────────────────

export const SOCIAL_PLATFORMS = ['x', 'github', 'discord', 'telegram', 'youtube', 'instagram', 'linkedin', 'farcaster', 'mastodon', 'email', 'website'] as const;
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];

/** Where an autofilled block came from, shown beside it ("filled from the name's extensions"). */
export type AutoSource = 'extension' | 'receive' | 'identity' | 'import';

interface BlockBase {
  readonly id: string;
  /** Present when PARSEC added the block; the person can edit or delete it like any other. */
  auto?: AutoSource;
}
export interface LinkBlock extends BlockBase { type: 'link'; label: string; url: string; icon: string }
export interface HeadingBlock extends BlockBase { type: 'heading'; text: string }
export interface TextBlock extends BlockBase { type: 'text'; text: string }
export interface ImageBlock extends BlockBase { type: 'image'; src: string; alt: string }
export interface EmbedBlock extends BlockBase { type: 'embed'; url: string; title: string }
export interface DividerBlock extends BlockBase { type: 'divider' }
export interface SocialBlock extends BlockBase { type: 'social'; links: { platform: SocialPlatform; url: string }[] }
export interface ButtonBlock extends BlockBase { type: 'button'; label: string; url: string }
export interface VerifyBlock extends BlockBase { type: 'verify'; label: string; url: string }

export type Block = LinkBlock | HeadingBlock | TextBlock | ImageBlock | EmbedBlock | DividerBlock | SocialBlock | ButtonBlock | VerifyBlock;
export type BlockType = Block['type'];

export const BLOCK_TYPES: readonly { type: BlockType; label: string }[] = [
  { type: 'link', label: 'Link' },
  { type: 'heading', label: 'Heading' },
  { type: 'text', label: 'Text' },
  { type: 'image', label: 'Image' },
  { type: 'embed', label: 'Embed' },
  { type: 'divider', label: 'Divider' },
  { type: 'social', label: 'Social row' },
  { type: 'button', label: 'Button' },
  { type: 'verify', label: 'Verify badge' },
];

// ── The document ─────────────────────────────────────────────────────────────

export interface Theme {
  template: TemplateId;
  font: FontId;
  /** 6-digit hex, e.g. #7aa2ff. */
  accent: string;
  /** 6-digit hex. */
  text: string;
  background: { kind: 'solid' | 'gradient'; from: string; to: string };
  buttonShape: ButtonShape;
  align: HeaderAlign;
  width: PageWidth;
}

export interface PageSettings {
  /** The page's own title (on the page and in the tab when no SEO title is set). */
  title: string;
  /** Overrides <title> and og:title when set. */
  seoTitle: string;
  seoDescription: string;
  /** One emoji, drawn as the favicon. */
  favicon: string;
  /** 'autogen' = generate card.svg; '' = none; else an image URL or ar://id. */
  ogImage: string;
  /** The person's own Arweave tags, added to the page item. */
  tags: DataItemTag[];
  /** Private labels: kept on this device, never uploaded. */
  labels: string[];
}

export interface PageDoc {
  schema: typeof PAGE_SCHEMA;
  /** Stable across versions: the same page, republished. */
  pageId: string;
  /** 1 for a page's first release; each deploy is the previous + 1. */
  version: number;
  /** Earlier versions' Target IDs, newest first — every one stays permanent, so rollback is a pointer. */
  previous: string[];
  versionNote: string;
  profile: {
    displayName: string;
    tagline: string;
    intro: string;
    /** '' = initials; 'autogen' = generated sigil (avatar.svg); 'avatar.webp' = an uploaded image; else ar://id or https URL. */
    avatar: string;
  };
  blocks: Block[];
  theme: Theme;
  settings: PageSettings;
  /** The ArNS name and, optionally, the extension the page is for ('' = the name's root). */
  domain: { name: string; extension: string };
}

/** Fields the autofill and the editor talk about by name. */
export type FieldKey =
  | 'displayName' | 'tagline' | 'intro' | 'avatar'
  | 'title' | 'seoTitle' | 'seoDescription' | 'favicon' | 'ogImage';

export const FIELD_LABELS: Readonly<Record<FieldKey, string>> = {
  displayName: 'Display name', tagline: 'Tagline', intro: 'Short intro', avatar: 'Avatar',
  title: 'Page title', seoTitle: 'SEO title', seoDescription: 'SEO / social description', favicon: 'Favicon', ogImage: 'Social image',
};

export function getField(doc: PageDoc, k: FieldKey): string {
  switch (k) {
    case 'displayName': case 'tagline': case 'intro': case 'avatar': return doc.profile[k];
    default: return doc.settings[k];
  }
}

export function setField(doc: PageDoc, k: FieldKey, v: string): PageDoc {
  switch (k) {
    case 'displayName': case 'tagline': case 'intro': case 'avatar': return { ...doc, profile: { ...doc.profile, [k]: v } };
    default: return { ...doc, settings: { ...doc.settings, [k]: v } };
  }
}

export function themeFromTemplate(id: TemplateId, keep?: Partial<Theme>): Theme {
  const t = templateById(id);
  return {
    template: t.id,
    font: t.font,
    accent: t.accent,
    text: t.text,
    background: { ...t.background },
    buttonShape: t.buttonShape,
    align: keep?.align ?? 'center',
    width: keep?.width ?? 'standard',
  };
}

/** A fresh page id: 16 random bytes as hex. The view supplies the randomness. */
export function newPageId(rand: Uint8Array): string {
  if (rand.length < 8) throw new Error('page id needs at least 8 random bytes');
  return Array.from(rand.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function blankDoc(opts: { pageId: string; name?: string; extension?: string; template?: TemplateId }): PageDoc {
  const theme = themeFromTemplate(opts.template ?? 'midnight');
  return {
    schema: PAGE_SCHEMA,
    pageId: opts.pageId,
    version: 1,
    previous: [],
    versionNote: '',
    profile: { displayName: '', tagline: '', intro: '', avatar: '' },
    blocks: [],
    theme,
    settings: { title: '', seoTitle: '', seoDescription: '', favicon: '', ogImage: '', tags: [], labels: [] },
    domain: { name: (opts.name ?? '').toLowerCase(), extension: (opts.extension ?? '').toLowerCase() },
  };
}

/** A template's starter: the same blank page with a few blocks to edit, never invented facts. */
export function templateDoc(opts: { pageId: string; name?: string; extension?: string; template: TemplateId }): PageDoc {
  const d = blankDoc(opts);
  return {
    ...d,
    blocks: [
      { id: 'b1', type: 'heading', text: 'Links' },
      { id: 'b2', type: 'link', label: '', url: '', icon: '' },
      { id: 'b3', type: 'divider' },
    ],
    settings: { ...d.settings, favicon: templateById(opts.template).favicon, ogImage: 'autogen' },
    profile: { ...d.profile, avatar: 'autogen' },
  };
}

export function nextBlockId(doc: PageDoc): string {
  let n = 0;
  for (const b of doc.blocks) {
    const m = /^b(\d+)$/.exec(b.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `b${n + 1}`;
}

export function emptyBlock(type: BlockType, id: string): Block {
  switch (type) {
    case 'link': return { id, type, label: '', url: '', icon: '' };
    case 'heading': return { id, type, text: '' };
    case 'text': return { id, type, text: '' };
    case 'image': return { id, type, src: '', alt: '' };
    case 'embed': return { id, type, url: '', title: '' };
    case 'divider': return { id, type };
    case 'social': return { id, type, links: [{ platform: 'x', url: '' }] };
    case 'button': return { id, type, label: '', url: '' };
    case 'verify': return { id, type, label: 'Verified', url: '' };
  }
}

export function moveBlock(doc: PageDoc, id: string, delta: -1 | 1): PageDoc {
  const i = doc.blocks.findIndex((b) => b.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= doc.blocks.length) return doc;
  const blocks = [...doc.blocks];
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  return { ...doc, blocks };
}

export function removeBlock(doc: PageDoc, id: string): PageDoc {
  return { ...doc, blocks: doc.blocks.filter((b) => b.id !== id) };
}

export function updateBlock(doc: PageDoc, id: string, patch: Partial<Block>): PageDoc {
  return { ...doc, blocks: doc.blocks.map((b) => (b.id === id ? ({ ...b, ...patch, id: b.id, type: b.type } as Block) : b)) };
}

// ── Versioning ───────────────────────────────────────────────────────────────

/** How many earlier ids a page carries; older ones stay permanent, just unlisted. */
export const MAX_PREVIOUS = 32;
const ID_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The document for the next release, built on what the name serves now. `current.target` is the id
 * the name points at; `current.page` is the page found there when it is one of ours. The served id
 * joins the head of `previous`, the version counts on from the served page, and the page keeps its
 * id — the same page, republished. Anything else (nothing served, the placeholder, a foreign page)
 * starts a fresh history at version 1.
 */
export function nextRelease(doc: PageDoc, current: { target?: string | null; page?: PageDoc | null }, placeholder: string): PageDoc {
  const t = current.target && ID_RE.test(current.target) && current.target !== placeholder ? current.target : null;
  const base = current.page ?? null;
  const history: string[] = [];
  for (const id of [...(t ? [t] : []), ...(base?.previous ?? [])]) if (!history.includes(id)) history.push(id);
  return {
    ...doc,
    pageId: base?.pageId || doc.pageId,
    version: base ? base.version + 1 : 1,
    previous: history.slice(0, MAX_PREVIOUS),
  };
}

export type ReleaseType = 'launch' | 'deploy';

/**
 * Launch: the first release to a name or extension that serves nothing of ours yet (nothing at
 * all, the ar.io placeholder, or a page not made here). Deploy: a new version of a page already there.
 */
export function releaseType(currentTarget: string | null | undefined, targetIsOurs: boolean, placeholder: string): ReleaseType {
  if (!currentTarget || currentTarget === placeholder) return 'launch';
  return targetIsOurs ? 'deploy' : 'launch';
}

// ── Validation (anything loaded from the network is untrusted) ───────────────

export function isHex6(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

const MAX_TEXT = 2000;
const MAX_SHORT = 300;
const MAX_BLOCKS = 200;
export const MAX_CUSTOM_TAGS = 32;
/** Tag names a person may not set: PARSEC writes these itself. */
export const RESERVED_TAG_NAMES = ['content-type', 'app-name', 'page-id', 'page-title', 'page-template', 'page-version', 'render-with'];

function str(v: unknown, max = MAX_SHORT): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function oneOf<T extends string>(v: unknown, all: readonly T[], dflt: T): T {
  return typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : dflt;
}
function hex(v: unknown, dflt: string): string {
  return typeof v === 'string' && isHex6(v) ? v.toLowerCase() : dflt;
}
function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Keep the person's own tags that are well-formed and not PARSEC's. */
export function cleanTags(v: unknown): DataItemTag[] {
  if (!Array.isArray(v)) return [];
  const out: DataItemTag[] = [];
  for (const t of v) {
    const r = rec(t);
    const name = str(r.name, 128).trim();
    const value = str(r.value, 1024).trim();
    if (!name || !value || RESERVED_TAG_NAMES.includes(name.toLowerCase())) continue;
    out.push({ name, value });
    if (out.length >= MAX_CUSTOM_TAGS) break;
  }
  return out;
}

function normalizeBlock(v: unknown, id: string): Block | null {
  const r = rec(v);
  const auto = oneOf(r.auto, ['extension', 'receive', 'identity', 'import'] as const, 'import');
  const withAuto = <B extends Block>(b: B): B => (typeof r.auto === 'string' ? { ...b, auto } : b);
  switch (r.type) {
    case 'link': return withAuto({ id, type: 'link', label: str(r.label), url: str(r.url, MAX_TEXT), icon: str(r.icon, 16) });
    case 'heading': return withAuto({ id, type: 'heading', text: str(r.text) });
    case 'text': return withAuto({ id, type: 'text', text: str(r.text, MAX_TEXT) });
    case 'image': return withAuto({ id, type: 'image', src: str(r.src, MAX_TEXT), alt: str(r.alt) });
    case 'embed': return withAuto({ id, type: 'embed', url: str(r.url, MAX_TEXT), title: str(r.title) });
    case 'divider': return withAuto({ id, type: 'divider' });
    case 'social': {
      const links = Array.isArray(r.links) ? r.links.slice(0, 20).map((l) => {
        const lr = rec(l);
        return { platform: oneOf(lr.platform, SOCIAL_PLATFORMS, 'website'), url: str(lr.url, MAX_TEXT) };
      }) : [];
      return withAuto({ id, type: 'social', links });
    }
    case 'button': return withAuto({ id, type: 'button', label: str(r.label), url: str(r.url, MAX_TEXT) });
    case 'verify': return withAuto({ id, type: 'verify', label: str(r.label), url: str(r.url, MAX_TEXT) });
    default: return null;
  }
}

/**
 * Any value → a well-formed PageDoc, or null when it is not one of ours. Every string is clamped,
 * every enum checked, every colour validated: the renderer escapes too, but a loaded page should
 * never carry more than the editor could have produced.
 */
export function normalizeDoc(v: unknown): PageDoc | null {
  const r = rec(v);
  if (r.schema !== PAGE_SCHEMA) return null;
  const profile = rec(r.profile);
  const theme = rec(r.theme);
  const bg = rec(theme.background);
  const settings = rec(r.settings);
  const domain = rec(r.domain);
  const template = oneOf(theme.template, TEMPLATES.map((t) => t.id), 'minimal');
  const tokens = templateById(template);
  const blocks: Block[] = [];
  if (Array.isArray(r.blocks)) {
    for (const b of r.blocks.slice(0, MAX_BLOCKS)) {
      const nb = normalizeBlock(b, `b${blocks.length + 1}`);
      if (nb) blocks.push(nb);
    }
  }
  const version = typeof r.version === 'number' && Number.isSafeInteger(r.version) && r.version >= 1 ? r.version : 1;
  return {
    schema: PAGE_SCHEMA,
    pageId: /^[0-9a-f]{16,32}$/.test(str(r.pageId)) ? str(r.pageId) : '',
    version,
    previous: Array.isArray(r.previous) ? r.previous.filter((p): p is string => typeof p === 'string' && ID_RE.test(p)).slice(0, MAX_PREVIOUS) : [],
    versionNote: str(r.versionNote),
    profile: { displayName: str(profile.displayName), tagline: str(profile.tagline), intro: str(profile.intro, MAX_TEXT), avatar: str(profile.avatar, MAX_TEXT) },
    blocks,
    theme: {
      template,
      font: oneOf(theme.font, Object.keys(FONTS) as FontId[], tokens.font),
      accent: hex(theme.accent, tokens.accent),
      text: hex(theme.text, tokens.text),
      background: { kind: oneOf(bg.kind, ['solid', 'gradient'] as const, tokens.background.kind), from: hex(bg.from, tokens.background.from), to: hex(bg.to, tokens.background.to) },
      buttonShape: oneOf(theme.buttonShape, ['pill', 'rounded', 'square'] as const, tokens.buttonShape),
      align: oneOf(theme.align, ['center', 'left'] as const, 'center'),
      width: oneOf(theme.width, ['standard', 'wide'] as const, 'standard'),
    },
    settings: {
      title: str(settings.title),
      seoTitle: str(settings.seoTitle),
      seoDescription: str(settings.seoDescription, 600),
      favicon: str(settings.favicon, 16),
      ogImage: str(settings.ogImage, MAX_TEXT),
      tags: cleanTags(settings.tags),
      labels: [],
    },
    domain: { name: str(domain.name, 51).toLowerCase(), extension: str(domain.extension, 61).toLowerCase() },
  };
}

/** What goes public: the document minus its private labels. */
export function publicDoc(doc: PageDoc): PageDoc {
  return { ...doc, settings: { ...doc.settings, labels: [] } };
}

/** The title a browser tab and a search result show. */
export function effectiveTitle(doc: PageDoc): string {
  return (doc.settings.seoTitle || doc.settings.title || doc.profile.displayName || doc.domain.name || 'A permanent page').trim();
}

export function effectiveDescription(doc: PageDoc): string {
  return (doc.settings.seoDescription || doc.profile.tagline).trim();
}

/** `ext_name` or `name` — how gateways spell the host label. */
export function hostLabel(domain: { name: string; extension: string }): string {
  return domain.extension ? `${domain.extension}_${domain.name}` : domain.name;
}
