// Auto edit suggestions — deterministic, explainable, one click to apply. Each rule looks at the
// document (and, for size and release, at the plan and the name), says in one line what it found and
// why it matters, and carries the edit that fixes it. Rules that need the app (recompressing an
// image, moving to the next step) carry an `action` the view runs instead of a pure `apply`.

import { contrastRatio, readableOn } from './color';
import {
  effectiveDescription,
  effectiveTitle,
  templateById,
  type Block,
  type PageDoc,
} from './model';

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;
/** WCAG AA for body text. */
export const CONTRAST_MIN = 4.5;
/** WCAG AA for large text and UI parts (the accent on links and buttons). */
export const CONTRAST_UI_MIN = 3;

export type SuggestionAction = 'recompress-avatar' | 'launch';

export interface Suggestion {
  readonly id: string;
  /** One line: what to change. */
  readonly title: string;
  /** Why it matters. */
  readonly why: string;
  readonly apply?: (doc: PageDoc) => PageDoc;
  readonly action?: SuggestionAction;
}

export interface SuggestContext {
  /** Signed sizes of the files as planned; any above the free limit costs credits. */
  readonly sizes?: readonly { path: string; size: number }[];
  readonly freeLimit?: number;
  /** The name serves nothing of ours yet (nothing, the ar.io placeholder, or a foreign page). */
  readonly launch?: boolean;
  /** Gateway-hosted URL prefixes with a known ar:// equivalent, e.g. https://docs_bankon.ar.io → ar://docs_bankon. */
  readonly known?: Readonly<Record<string, string>>;
}

/** Cut at a word boundary to at most `max` characters, with an ellipsis. */
export function shorten(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

function firstSentence(s: string): string {
  const t = s.trim().split('\n')[0];
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return (m ? m[1] : t).trim();
}

/** Gateways whose URLs carry an id or a name: the same thing has a gateway-free ar:// form. */
const GATEWAY_HOSTS = ['arweave.net', 'ar.io', 'permagate.io', 'turbo-gateway.com', 'ar-io.dev', 'g8way.io'];

/** A gateway URL's ar:// equivalent, or null. https://arweave.net/<id> → ar://<id>; https://x_name.ar.io/ → ar://x_name. */
export function arEquivalent(url: string, known?: Readonly<Record<string, string>>): string | null {
  const v = url.trim();
  if (known) {
    for (const [prefix, ar] of Object.entries(known)) if (v.replace(/\/+$/, '') === prefix.replace(/\/+$/, '')) return ar;
  }
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const gw = GATEWAY_HOSTS.find((g) => host === g || host.endsWith(`.${g}`));
  if (!gw) return null;
  const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`;
  if (host === gw) {
    const m = /^\/([A-Za-z0-9_-]{43})(\/.*)?$/.exec(u.pathname);
    return m ? `ar://${m[1]}${m[2] ?? ''}${u.search}${u.hash}` : null;
  }
  const label = host.slice(0, -(gw.length + 1));
  if (!/^[a-z0-9_-]{1,113}$/.test(label)) return null; // sandbox subdomains (base32 of an id) are not names
  if (/^[a-z2-7]{52}$/.test(label)) return null;
  return `ar://${label}${rest}`;
}

function isEmptyBlock(b: Block): boolean {
  switch (b.type) {
    case 'link': return !b.url.trim();
    case 'heading': case 'text': return !b.text.trim();
    case 'image': return !b.src.trim();
    case 'embed': return !b.url.trim();
    case 'divider': return false;
    case 'social': return b.links.every((l) => !l.url.trim());
    case 'button': return !b.url.trim() || !b.label.trim();
    case 'verify': return !b.url.trim();
  }
}

function blockUrls(b: Block): string[] {
  switch (b.type) {
    case 'link': case 'button': case 'verify': case 'embed': return [b.url];
    case 'image': return [b.src];
    case 'social': return b.links.map((l) => l.url);
    default: return [];
  }
}

function mapUrls(doc: PageDoc, f: (u: string) => string): PageDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b): Block => {
      switch (b.type) {
        case 'link': case 'button': case 'verify': case 'embed': return { ...b, url: f(b.url) };
        case 'image': return { ...b, src: f(b.src) };
        case 'social': return { ...b, links: b.links.map((l) => ({ ...l, url: f(l.url) })) };
        default: return b;
      }
    }),
  };
}

const normUrl = (u: string): string => u.trim().toLowerCase().replace(/\/+$/, '');

/** The worst text-on-background contrast: a gradient is judged at both ends. */
export function textContrast(doc: PageDoc): number {
  const bg = doc.theme.background;
  const stops = bg.kind === 'gradient' ? [bg.from, bg.to] : [bg.from];
  return Math.min(...stops.map((c) => contrastRatio(doc.theme.text, c)));
}

export function accentContrast(doc: PageDoc): number {
  const bg = doc.theme.background;
  const stops = bg.kind === 'gradient' ? [bg.from, bg.to] : [bg.from];
  return Math.min(...stops.map((c) => contrastRatio(doc.theme.accent, c)));
}

/** Every rule, in the order the panel shows them. */
export function suggest(doc: PageDoc, ctx: SuggestContext = {}): Suggestion[] {
  const out: Suggestion[] = [];
  const name = doc.domain.name;
  const display = doc.profile.displayName.trim() || name;

  if (ctx.launch) {
    out.push({
      id: 'launch',
      title: `Launch: ${name || 'this name'} serves nothing of yours yet`,
      why: 'This release is the first page at this address. Launching sets version 1; every later deploy keeps the earlier ones permanent.',
      action: 'launch',
    });
  }

  if (!doc.profile.displayName.trim() && name) {
    out.push({ id: 'name-missing', title: 'The page has no display name', why: 'The heading is the first thing a visitor reads.', apply: (d) => ({ ...d, profile: { ...d.profile, displayName: name } }) });
  }

  const title = effectiveTitle(doc);
  if (!doc.settings.title.trim() && !doc.settings.seoTitle.trim()) {
    out.push({ id: 'title-missing', title: 'No page title', why: 'Tabs, bookmarks and search results show the title.', apply: (d) => ({ ...d, settings: { ...d.settings, title: display || name.toUpperCase() } }) });
  } else if (title.length > TITLE_MAX) {
    out.push({ id: 'title-long', title: `The title is ${title.length} characters (search shows about ${TITLE_MAX})`, why: 'Longer titles are cut off in search results.', apply: (d) => ({ ...d, settings: { ...d.settings, seoTitle: shorten(effectiveTitle(d), TITLE_MAX) } }) });
  }

  const desc = effectiveDescription(doc);
  if (!desc) {
    const from = firstSentence(doc.profile.intro) || `${display} — a permanent page at ar://${name}`;
    out.push({ id: 'desc-missing', title: 'No description for search and social previews', why: 'Without one, sites show whatever text they find first.', apply: (d) => ({ ...d, settings: { ...d.settings, seoDescription: shorten(from, DESCRIPTION_MAX) } }) });
  } else if (desc.length > DESCRIPTION_MAX) {
    out.push({ id: 'desc-long', title: `The description is ${desc.length} characters (previews show about ${DESCRIPTION_MAX})`, why: 'Longer descriptions are cut off mid-sentence.', apply: (d) => ({ ...d, settings: { ...d.settings, seoDescription: shorten(effectiveDescription(d), DESCRIPTION_MAX) } }) });
  }

  if (!doc.settings.ogImage.trim()) {
    out.push({ id: 'og-missing', title: 'No social image', why: 'Shared links show a card; PARSEC can generate one from the name and tagline.', apply: (d) => ({ ...d, settings: { ...d.settings, ogImage: 'autogen' } }) });
  }

  if (!doc.profile.avatar.trim()) {
    out.push({ id: 'avatar-missing', title: 'No avatar — the page shows initials', why: 'A sigil generated from the name is about 2 KB and stays with the page.', apply: (d) => ({ ...d, profile: { ...d.profile, avatar: 'autogen' } }) });
  }

  if (!doc.settings.favicon.trim()) {
    const fav = templateById(doc.theme.template).favicon;
    out.push({ id: 'favicon-missing', title: `No favicon — use the template's ${fav}`, why: 'The tab shows a blank icon otherwise.', apply: (d) => ({ ...d, settings: { ...d.settings, favicon: fav } }) });
  }

  const noAlt = doc.blocks.filter((b) => b.type === 'image' && b.src.trim() && !b.alt.trim());
  if (noAlt.length) {
    out.push({
      id: 'alt-missing', title: `${noAlt.length} image${noAlt.length === 1 ? ' has' : 's have'} no alt text`,
      why: 'Screen readers read alt text aloud; search engines read it too.',
      apply: (d) => ({ ...d, blocks: d.blocks.map((b) => (b.type === 'image' && b.src.trim() && !b.alt.trim() ? { ...b, alt: `Image on ${d.profile.displayName.trim() || d.domain.name}'s page` } : b)) }),
    });
  }

  const urls = doc.blocks.flatMap(blockUrls).filter((u) => u.trim());
  const insecure = urls.filter((u) => /^http:\/\//i.test(u.trim()));
  if (insecure.length) {
    out.push({
      id: 'http-links', title: `${insecure.length} link${insecure.length === 1 ? ' uses' : 's use'} http://`,
      why: 'Browsers warn on plain http; almost every site answers on https.',
      apply: (d) => mapUrls(d, (u) => u.trim().replace(/^http:\/\//i, 'https://')),
    });
  }

  // <name>.ar.io is ArNS's own canonical address (what autofill writes); everything else that pins
  // one gateway, or a host the person mirrors permanently (ctx.known), has a better ar:// form.
  const pinned = (u: string): string | null => (/^https:\/\/[^/]+\.ar\.io(\/|$)/i.test(u.trim()) && !ctx.known?.[u.trim()] ? null : arEquivalent(u, ctx.known));
  const gated = urls.filter((u) => pinned(u));
  if (gated.length) {
    out.push({
      id: 'ar-links', title: `${gated.length} link${gated.length === 1 ? ' is' : 's are'} tied to one host — use ar://`,
      why: 'A gateway or a web host can go down; an ar:// link is permanent and opens on whichever gateway serves the page.',
      apply: (d) => mapUrls(d, (u) => pinned(u) ?? u),
    });
  }

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const b of doc.blocks) {
    if (b.type !== 'link' || !b.url.trim()) continue;
    const k = normUrl(b.url);
    if (seen.has(k)) dupes.add(b.id); else seen.add(k);
  }
  if (dupes.size) {
    out.push({
      id: 'duplicate-links', title: `${dupes.size} duplicate link${dupes.size === 1 ? '' : 's'}`,
      why: 'The same destination twice reads as a mistake.',
      apply: (d) => {
        const s = new Set<string>();
        return { ...d, blocks: d.blocks.filter((b) => {
          if (b.type !== 'link' || !b.url.trim()) return true;
          const k = normUrl(b.url);
          if (s.has(k)) return false;
          s.add(k);
          return true;
        }) };
      },
    });
  }

  const empty = doc.blocks.filter(isEmptyBlock);
  if (empty.length) {
    out.push({
      id: 'empty-blocks', title: `${empty.length} empty block${empty.length === 1 ? '' : 's'}`,
      why: 'Empty blocks are left out of the page anyway; removing them keeps the editor honest.',
      apply: (d) => ({ ...d, blocks: d.blocks.filter((b) => !isEmptyBlock(b)) }),
    });
  }

  const tc = textContrast(doc);
  if (tc < CONTRAST_MIN) {
    const tpl = templateById(doc.theme.template).text;
    out.push({
      id: 'low-contrast', title: `Text contrast is ${tc.toFixed(1)}:1 (needs ${CONTRAST_MIN}:1)`,
      why: 'Low-contrast text is hard to read, for everyone and especially on phones in daylight.',
      apply: (d) => {
        const bg = d.theme.background;
        const stops = bg.kind === 'gradient' ? [bg.from, bg.to] : [bg.from];
        const ok = (c: string): boolean => stops.every((s) => contrastRatio(c, s) >= CONTRAST_MIN);
        const text = ok(tpl) ? tpl : readableOn(bg.from);
        return { ...d, theme: { ...d.theme, text } };
      },
    });
  }

  const ac = accentContrast(doc);
  if (ac < CONTRAST_UI_MIN) {
    const tpl = templateById(doc.theme.template).accent;
    out.push({
      id: 'accent-contrast', title: `Links and buttons contrast ${ac.toFixed(1)}:1 with the background (needs ${CONTRAST_UI_MIN}:1)`,
      why: 'The accent draws every link outline and button.',
      apply: (d) => {
        const bg = d.theme.background;
        const stops = bg.kind === 'gradient' ? [bg.from, bg.to] : [bg.from];
        const ok = (c: string): boolean => stops.every((s) => contrastRatio(c, s) >= CONTRAST_UI_MIN);
        return { ...d, theme: { ...d.theme, accent: ok(tpl) ? tpl : readableOn(bg.from) } };
      },
    });
  }

  if (ctx.sizes && ctx.freeLimit) {
    const over = ctx.sizes.filter((s) => s.size > ctx.freeLimit!);
    if (over.length) {
      const avatarOver = over.some((s) => s.path.startsWith('avatar.'));
      out.push({
        id: 'over-free', title: `${over.map((s) => s.path).join(', ')} ${over.length === 1 ? 'is' : 'are'} over the free limit`,
        why: `Items up to ${ctx.freeLimit.toLocaleString()} bytes are free; larger ones need Turbo credits.${avatarOver ? ' Recompressing the avatar usually brings it under.' : ''}`,
        ...(avatarOver ? { action: 'recompress-avatar' as const } : {}),
      });
    }
  }
  return out;
}
