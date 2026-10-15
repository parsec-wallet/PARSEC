import { describe, expect, it } from 'vitest';
import {
  MAX_PREVIOUS,
  PAGE_SCHEMA,
  TEMPLATES,
  blankDoc,
  emptyBlock,
  moveBlock,
  newPageId,
  nextBlockId,
  nextRelease,
  normalizeDoc,
  releaseType,
  templateDoc,
  type PageDoc,
} from '../model';
import { autofill, receiveUri } from '../autofill';
import { cardSvg, hash32, initials, sigilSvg, wrapText } from '../autogen';
import { contrastRatio, luminance, readableOn } from '../color';
import { AVATAR_SVG, CARD_SVG, embedJson, faviconHref, renderPage, resolveUrl } from '../render';
import { absolutize, emojiFromFavicon, importPage, simplifyHtml } from '../importer';
import { arEquivalent, shorten, suggest } from '../suggest';
import { INFT_MINT_ENABLED, INFT_MINT_REASON, buildInftMetadata } from '../inft';
import { FREE_LIMIT_FALLBACK_BYTES, planUpload } from '../../arweave/turbo';
import { ARIO_PLACEHOLDER_TARGET } from '../../names/controller-model';

const PID = '0123456789abcdef0123456789abcdef';
const ID_A = 'A'.repeat(43);
const ID_B = 'B'.repeat(43);
const ID_C = 'C'.repeat(43);

function typical(): PageDoc {
  const d = templateDoc({ pageId: PID, name: 'bankon', template: 'midnight' });
  return {
    ...d,
    profile: { displayName: 'BANKON', tagline: 'Permanent names and the Bitcoin wallet', intro: 'Built on the permaweb.\n\nSecond paragraph.', avatar: 'autogen' },
    settings: { ...d.settings, title: 'BANKON', seoDescription: 'Permanent names and the Bitcoin wallet', favicon: '🌙', ogImage: 'autogen', tags: [{ name: 'Topic', value: 'names' }], labels: ['private-thing'] },
    blocks: [
      { id: 'b1', type: 'heading', text: 'Links' },
      { id: 'b2', type: 'link', label: 'Docs', url: 'https://docs_bankon.ar.io', icon: '📚' },
      { id: 'b3', type: 'link', label: 'GitHub', url: 'https://github.com/bankon', icon: '' },
      { id: 'b4', type: 'social', links: [{ platform: 'x', url: 'https://x.com/bankon' }, { platform: 'email', url: 'hi@bankon.example' }] },
      { id: 'b5', type: 'image', src: 'ar://' + ID_A, alt: 'A diagram' },
      { id: 'b6', type: 'button', label: 'Open the wallet', url: 'ar://parsec' },
      { id: 'b7', type: 'verify', label: 'Verified', url: 'https://verify.example/bankon' },
      { id: 'b8', type: 'divider' },
      { id: 'b9', type: 'text', text: 'Thanks for visiting.' },
    ],
  };
}

// ── model ────────────────────────────────────────────────────────────────────

describe('model', () => {
  it('blank and template docs have sane defaults', () => {
    const d = blankDoc({ pageId: PID, name: 'Bankon' });
    expect(d.schema).toBe(PAGE_SCHEMA);
    expect(d.version).toBe(1);
    expect(d.previous).toEqual([]);
    expect(d.domain).toEqual({ name: 'bankon', extension: '' });
    expect(d.theme.template).toBe('midnight');
    const t = templateDoc({ pageId: PID, name: 'x', template: 'paper' });
    expect(t.theme.font).toBe('serif');
    expect(t.settings.favicon).toBe(TEMPLATES.find((x) => x.id === 'paper')!.favicon);
    expect(t.profile.avatar).toBe('autogen');
  });

  it('has the eight templates with valid colours', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['minimal', 'midnight', 'aurora', 'paper', 'terminal', 'classic', 'modern', 'professional']);
    for (const t of TEMPLATES) for (const c of [t.text, t.accent, t.background.from, t.background.to]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    // Every template's own text passes WCAG AA on its own background.
    for (const t of TEMPLATES) expect(contrastRatio(t.text, t.background.from)).toBeGreaterThanOrEqual(4.5);
  });

  it('page ids are hex and need randomness', () => {
    expect(newPageId(new Uint8Array(16).fill(255))).toBe('f'.repeat(32));
    expect(() => newPageId(new Uint8Array(2))).toThrow();
  });

  it('block ids count up and moves stay in range', () => {
    const d = typical();
    expect(nextBlockId(d)).toBe('b10');
    const m = moveBlock(d, 'b1', 1);
    expect(m.blocks[1].id).toBe('b1');
    expect(moveBlock(d, 'b1', -1)).toBe(d);
    expect(emptyBlock('social', 'b1')).toMatchObject({ type: 'social', links: [{ platform: 'x', url: '' }] });
  });

  it('versioning: a deploy counts on from the served page and keeps its id in history', () => {
    const served = { ...typical(), version: 3, previous: [ID_B] };
    const next = nextRelease({ ...typical(), pageId: 'ffffffffffffffff' }, { target: ID_A, page: served }, ARIO_PLACEHOLDER_TARGET);
    expect(next.version).toBe(4);
    expect(next.previous).toEqual([ID_A, ID_B]);
    expect(next.pageId).toBe(PID);
  });

  it('versioning: placeholder, nothing, or a foreign page start at version 1', () => {
    expect(nextRelease(typical(), { target: ARIO_PLACEHOLDER_TARGET }, ARIO_PLACEHOLDER_TARGET)).toMatchObject({ version: 1, previous: [] });
    expect(nextRelease(typical(), { target: null }, ARIO_PLACEHOLDER_TARGET)).toMatchObject({ version: 1, previous: [] });
    expect(nextRelease(typical(), { target: ID_C, page: null }, ARIO_PLACEHOLDER_TARGET)).toMatchObject({ version: 1, previous: [ID_C] });
  });

  it('versioning: history is deduplicated and capped', () => {
    const long = Array.from({ length: 40 }, (_, i) => String(i).padStart(43, 'x'));
    const served = { ...typical(), version: 9, previous: [ID_A, ...long] };
    const n = nextRelease(typical(), { target: ID_A, page: served }, ARIO_PLACEHOLDER_TARGET);
    expect(n.previous[0]).toBe(ID_A);
    expect(n.previous.filter((p) => p === ID_A)).toHaveLength(1);
    expect(n.previous).toHaveLength(MAX_PREVIOUS);
  });

  it('release type: launch vs deploy', () => {
    expect(releaseType(undefined, false, ARIO_PLACEHOLDER_TARGET)).toBe('launch');
    expect(releaseType(ARIO_PLACEHOLDER_TARGET, false, ARIO_PLACEHOLDER_TARGET)).toBe('launch');
    expect(releaseType(ID_A, false, ARIO_PLACEHOLDER_TARGET)).toBe('launch');
    expect(releaseType(ID_A, true, ARIO_PLACEHOLDER_TARGET)).toBe('deploy');
  });

  it('normalizeDoc clamps and validates untrusted input', () => {
    expect(normalizeDoc({ schema: 'other' })).toBeNull();
    const d = normalizeDoc({
      schema: PAGE_SCHEMA, version: -3, pageId: 'not hex',
      theme: { template: 'evil', accent: 'red', background: { kind: 'gradient', from: '#ABCDEF', to: 'x' } },
      blocks: [{ type: 'link', label: 'a'.repeat(5000), url: 'https://x' }, { type: 'script' }],
      settings: { tags: [{ name: 'App-Name', value: 'X' }, { name: 'Topic', value: 'y' }], labels: ['secret'] },
      previous: ['short', ID_A],
    })!;
    expect(d.version).toBe(1);
    expect(d.pageId).toBe('');
    expect(d.theme.template).toBe('minimal');
    expect(d.theme.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(d.theme.background.from).toBe('#abcdef');
    expect(d.blocks).toHaveLength(1);
    expect((d.blocks[0] as { label: string }).label.length).toBeLessThanOrEqual(300);
    expect(d.settings.tags).toEqual([{ name: 'Topic', value: 'y' }]);
    expect(d.settings.labels).toEqual([]);
    expect(d.previous).toEqual([ID_A]);
  });
});

// ── autofill ─────────────────────────────────────────────────────────────────

describe('autofill', () => {
  const identity = { nickname: 'Bankon Names', ticker: 'BNK', description: 'Permanent names on ar.io', keywords: ['names'], logo: ID_A };

  it('fills empty fields from the identity and marks them', () => {
    const r = autofill(blankDoc({ pageId: PID, name: 'bankon' }), { name: 'bankon', identity, extensions: ['docs', 'tnt'] });
    expect(r.doc.profile.displayName).toBe('Bankon Names');
    expect(r.doc.settings.title).toBe('Bankon Names');
    expect(r.doc.profile.tagline).toBe('Permanent names on ar.io');
    expect(r.doc.settings.seoDescription).toBe('Permanent names on ar.io');
    expect(r.doc.profile.avatar).toBe(`ar://${ID_A}`);
    expect(r.doc.settings.ogImage).toBe('autogen');
    expect(r.doc.settings.favicon).toBe('🌙');
    expect(r.filled).toMatchObject({ displayName: 'identity', title: 'identity', tagline: 'identity', avatar: 'identity', favicon: 'template', ogImage: 'autogen' });
    const links = r.doc.blocks.filter((b) => b.type === 'link');
    expect(links.map((b) => (b as { url: string }).url)).toEqual(['https://docs_bankon.ar.io', 'https://tnt_bankon.ar.io']);
    expect(links.every((b) => b.auto === 'extension')).toBe(true);
    expect(r.addedBlocks).toBe(2);
  });

  it('falls back to the name, and to the sigil when the logo does not resolve; invents nothing', () => {
    const r = autofill(blankDoc({ pageId: PID, name: 'bankon' }), { name: 'bankon', identity: { ...identity, nickname: '', description: '' }, logoReachable: false });
    expect(r.doc.profile.displayName).toBe('bankon');
    expect(r.doc.settings.title).toBe('BANKON');
    expect(r.doc.profile.avatar).toBe('autogen');
    expect(r.doc.profile.tagline).toBe('');
    expect(r.doc.profile.intro).toBe('');
    expect(r.doc.settings.seoDescription).toBe('');
    expect(r.filled.displayName).toBe('name');
    expect(r.filled.avatar).toBe('autogen');
  });

  it('never overwrites what the person typed, even an emptied field', () => {
    const d = blankDoc({ pageId: PID, name: 'bankon' });
    d.profile.displayName = 'My own name';
    const r = autofill(d, { name: 'bankon', identity }, new Set(['tagline']));
    expect(r.doc.profile.displayName).toBe('My own name');
    expect(r.doc.profile.tagline).toBe('');
    expect(r.filled.displayName).toBeUndefined();
    expect(r.filled.tagline).toBeUndefined();
  });

  it('adds receive links only when asked, once each', () => {
    const addresses = [{ label: 'Solana', address: 'So1anaAddre55xxxxxxxxxxxxxxxxxxxxxxxxxxxxx', uri: 'solana:So1anaAddre55xxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }];
    const off = autofill(blankDoc({ pageId: PID, name: 'n' }), { name: 'n', addresses });
    expect(off.doc.blocks).toHaveLength(0);
    const on = autofill(blankDoc({ pageId: PID, name: 'n' }), { name: 'n', addresses, includeReceive: true });
    expect(on.doc.blocks).toHaveLength(1);
    expect(on.doc.blocks[0].auto).toBe('receive');
    const again = autofill(on.doc, { name: 'n', addresses, includeReceive: true });
    expect(again.doc.blocks).toHaveLength(1);
    expect(receiveUri('bitcoin', 'bc1q')).toBe('bitcoin:bc1q');
    expect(receiveUri('algorand', 'ABC')).toBe('algorand://ABC');
    expect(receiveUri('monero', 'x')).toBeUndefined();
  });
});

// ── autogen ──────────────────────────────────────────────────────────────────

describe('autogen', () => {
  it('is deterministic per name and differs between names', () => {
    expect(sigilSvg('bankon', '#7aa2ff')).toBe(sigilSvg('bankon', '#7aa2ff'));
    expect(sigilSvg('bankon', '#7aa2ff')).not.toBe(sigilSvg('deltaverse', '#7aa2ff'));
    expect(hash32('bankon')).toBe(hash32('bankon'));
  });

  it('produces small, well-formed SVG', () => {
    for (const svg of [sigilSvg('bankon', '#7aa2ff'), cardSvg({ host: 'bankon', title: 'BANKON <&>', tagline: 'A long tagline that keeps going and going so it has to wrap onto two lines at least', accent: '#7aa2ff', background: { from: '#000000', to: '#111111' }, text: '#ffffff', font: 'system-ui' })]) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).not.toMatch(/<[^>]*&(?!amp;|lt;|gt;|quot;|apos;)/);
      expect(svg).not.toContain('NaN');
      expect(new TextEncoder().encode(svg).length).toBeLessThan(6000);
      // Every opened tag is closed or self-closed.
      const opens = (svg.match(/<(svg|defs|linearGradient|text)\b/g) ?? []).length;
      const closes = (svg.match(/<\/(svg|defs|linearGradient|text)>/g) ?? []).length;
      expect(opens).toBe(closes);
    }
    expect(cardSvg({ host: 'b', title: '<x>', tagline: '', accent: '#000000', background: { from: '#ffffff', to: '#ffffff' }, text: '#000000', font: 'serif' })).toContain('&lt;x&gt;');
  });

  it('wraps and initials', () => {
    expect(wrapText('one two three four', 9, 2)).toEqual(['one two', 'three…']);
    expect(wrapText('short', 20, 2)).toEqual(['short']);
    expect(initials('Bankon Names')).toBe('BN');
    expect(initials('bankon')).toBe('BA');
  });
});

// ── colour ───────────────────────────────────────────────────────────────────

describe('contrast', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(readableOn('#000080')).toBe('#ffffff');
    expect(readableOn('#ffff00')).toBe('#000000');
  });
});

// ── render ───────────────────────────────────────────────────────────────────

describe('render', () => {
  it('produces index.html plus the generated avatar and card, tagged', () => {
    const { files, html } = renderPage(typical());
    expect(files.map((f) => f.path)).toEqual(['index.html', AVATAR_SVG, CARD_SVG]);
    const tags = files[0].tags!;
    const tag = (n: string) => tags.find((t) => t.name === n)?.value;
    expect(tag('Page-Title')).toBe('BANKON');
    expect(tag('Page-Template')).toBe('midnight');
    expect(tag('Page-Version')).toBe('1');
    expect(tag('Render-With')).toBe('parsec-creator');
    expect(tag('Page-Id')).toBe(PID);
    expect(tag('Topic')).toBe('names');
    expect(html).toContain('<meta property="og:image" content="card.svg">');
    expect(html).toContain('src="avatar.svg"');
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
  });

  it('the embedded JSON round-trips through the importer, without private labels', () => {
    const doc = typical();
    const { html } = renderPage(doc);
    const r = importPage(simplifyHtml(html), { pageId: 'f'.repeat(32), name: 'bankon', extension: '' });
    expect(r.source).toBe('parsec');
    expect(r.doc).toEqual({ ...doc, settings: { ...doc.settings, labels: [] } });
  });

  it('cannot be broken out of by hostile text', () => {
    const d = typical();
    d.profile.displayName = '</script><script>alert(1)</script>';
    d.blocks = [{ id: 'b1', type: 'link', label: 'x', url: 'javascript:alert(1)', icon: '' }, { id: 'b2', type: 'link', label: '"><img onerror=x>', url: 'https://ok.example', icon: '' }];
    const { html: full } = renderPage(d);
    // The embedded JSON is data (escaped, never executed); the rendered markup is what must be clean.
    const html = full.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('"><img onerror');
    expect(embedJson(d)).not.toContain('</script>');
    const back = importPage(simplifyHtml(full), { pageId: PID, name: 'bankon', extension: '' });
    expect(back.doc.profile.displayName).toBe(d.profile.displayName);
  });

  it('loads nothing external: every URL in the HTML is one of the person\'s own', () => {
    const doc = typical();
    const { html } = renderPage(doc);
    const urls = Array.from(html.matchAll(/(?:href|src|content)="(https?:[^"]+)"/g), (m) => m[1].replace(/&amp;/g, '&'));
    const allowed = new Set([
      'https://docs_bankon.ar.io', 'https://github.com/bankon', 'https://x.com/bankon', `https://arweave.net/${ID_A}`,
      'https://parsec.ar.io', 'https://verify.example/bankon',
    ]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(allowed.has(u)).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toContain('@import');
  });

  it('resolves URLs safely', () => {
    expect(resolveUrl(`ar://${ID_A}`)).toEqual({ href: `https://arweave.net/${ID_A}`, ar: ID_A });
    expect(resolveUrl('ar://docs_bankon/x')).toEqual({ href: 'https://docs_bankon.ar.io/x', ar: 'docs_bankon/x' });
    expect(resolveUrl('hi@example.com')).toEqual({ href: 'mailto:hi@example.com' });
    expect(resolveUrl('javascript:alert(1)')).toBeNull();
    expect(resolveUrl('data:text/html,x')).toBeNull();
    expect(resolveUrl('avatar.svg')).toBeNull();
    expect(resolveUrl('avatar.svg', ['avatar.svg'])).toEqual({ href: 'avatar.svg' });
    expect(faviconHref('🌙')).toMatch(/^data:image\/svg\+xml,/);
  });

  it('a typical page is free: every item under the free limit', () => {
    const { files } = renderPage(typical());
    const plan = planUpload(files, FREE_LIMIT_FALLBACK_BYTES, { asSite: true });
    expect(plan.allFree).toBe(true);
    expect(plan.totalBytes).toBeLessThan(FREE_LIMIT_FALLBACK_BYTES);
    expect(plan.manifest?.index).toBe('index.html');
    expect(plan.items[0].tags.slice(0, 2)).toEqual([{ name: 'Content-Type', value: 'text/html' }, { name: 'App-Name', value: 'Parsec' }]);
    expect(plan.items[0].tags.some((t) => t.name === 'Page-Version')).toBe(true);
  });
});

// ── importer ─────────────────────────────────────────────────────────────────

describe('importer', () => {
  const SAMPLE = `<!doctype html><html><head><title>Alice &amp; Co</title>
    <meta name="description" content="Builder of things">
    <meta property="og:image" content="card.png">
    <link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3Ctext%3E%F0%9F%9A%80%3C/text%3E%3C/svg%3E">
    <style>h1{color:red}</style><script>var a = "<a href='https://evil'>x</a>";</script></head>
    <body><h1>Alice</h1><p>I build <b>permanent</b> things.</p>
    <h2>Projects</h2><a href="https://github.com/alice">GitHub</a><a href="https://github.com/alice/">dup</a>
    <a href="#top">top</a><a href="javascript:void(0)">js</a><a href="docs/index.html">Docs</a>
    <h3>Pictures</h3><img src="https://example.com/a.png" alt="A photo"><img src="local.png">
    </body></html>`;

  it('extracts an editable document from arbitrary HTML (regex path)', () => {
    const r = importPage(simplifyHtml(SAMPLE), { pageId: PID, name: 'alice', extension: '', paths: { 'docs/index.html': ID_B, 'card.png': ID_C } });
    expect(r.source).toBe('extracted');
    const d = r.doc;
    expect(d.profile.displayName).toBe('Alice');
    expect(d.profile.tagline).toBe('I build permanent things.');
    expect(d.settings.title).toBe('Alice & Co');
    expect(d.settings.seoDescription).toBe('Builder of things');
    expect(d.settings.ogImage).toBe(`ar://${ID_C}`);
    expect(d.settings.favicon).toBe('🚀');
    const kinds = d.blocks.map((b) => b.type);
    expect(kinds).toEqual(['heading', 'link', 'link', 'link', 'heading', 'image']);
    const urls = d.blocks.filter((b) => b.type === 'link').map((b) => (b as { url: string }).url);
    expect(urls).toEqual(['https://github.com/alice', 'https://github.com/alice/', `ar://${ID_B}`]);
    expect(urls.some((u) => u.includes('evil'))).toBe(false);
  });

  it('maps an ar.io-Pages-style embedded JSON blob', () => {
    const blob = { page: { profile: { displayName: 'Bob', tagline: 'Hi', avatar: 'https://x/a.png' }, theme: { template: 'Aurora', accent: '#FF0000' },
      blocks: [{ type: 'link', data: { label: 'Site', url: 'https://bob.example', icon: '🌐' } }, { type: 'mystery' }, { type: 'divider' }, { type: 'social', links: [{ platform: 'twitter', url: 'https://x.com/bob' }] }] } };
    const html = `<html><body><script type="application/json" id="__DATA__">${JSON.stringify(blob)}</script><h1>ignored</h1></body></html>`;
    const r = importPage(simplifyHtml(html), { pageId: PID, name: 'bob', extension: '' });
    expect(r.source).toBe('ario-pages');
    expect(r.doc.profile.displayName).toBe('Bob');
    expect(r.doc.theme.template).toBe('aurora');
    expect(r.doc.theme.accent).toBe('#ff0000');
    expect(r.doc.blocks.map((b) => b.type)).toEqual(['link', 'divider', 'social']);
    expect(r.doc.blocks[2]).toMatchObject({ links: [{ platform: 'x', url: 'https://x.com/bob' }] });
  });

  it('absolutize and favicon helpers', () => {
    expect(absolutize('./a.png', { 'a.png': ID_A })).toBe(`ar://${ID_A}`);
    expect(absolutize('missing.png')).toBe('');
    expect(absolutize('javascript:x')).toBe('');
    expect(absolutize('data:image/png;base64,xx')).toBe('');
    expect(emojiFromFavicon('https://x/favicon.ico')).toBe('');
  });

  it('re-import of an uploaded avatar points at its id in the old manifest', () => {
    const d = { ...typical(), profile: { ...typical().profile, avatar: 'avatar.webp' } };
    const { html } = renderPage(d, { avatarFile: { path: 'avatar.webp', bytes: new Uint8Array([1, 2, 3]), contentType: 'image/webp' } });
    const r = importPage(simplifyHtml(html), { pageId: PID, name: 'bankon', extension: '', paths: { 'avatar.webp': ID_B } });
    expect(r.doc.profile.avatar).toBe(`ar://${ID_B}`);
  });
});

// ── suggestions ──────────────────────────────────────────────────────────────

describe('suggestions', () => {
  const ids = (d: PageDoc, ctx = {}) => suggest(d, ctx).map((s) => s.id);
  const applyOne = (d: PageDoc, id: string, ctx = {}): PageDoc => suggest(d, ctx).find((s) => s.id === id)!.apply!(d);

  it('a typical page has no suggestions', () => {
    expect(ids(typical())).toEqual([]);
  });

  it('each rule fires, and its apply fixes it', () => {
    const base = typical();
    const cases: [string, PageDoc][] = [
      ['name-missing', { ...base, profile: { ...base.profile, displayName: '' } }],
      ['title-missing', { ...base, settings: { ...base.settings, title: '', seoTitle: '' } }],
      ['title-long', { ...base, settings: { ...base.settings, title: 'word '.repeat(20) } }],
      ['desc-missing', { ...base, profile: { ...base.profile, tagline: '' }, settings: { ...base.settings, seoDescription: '' } }],
      ['desc-long', { ...base, settings: { ...base.settings, seoDescription: 'word '.repeat(50) } }],
      ['og-missing', { ...base, settings: { ...base.settings, ogImage: '' } }],
      ['avatar-missing', { ...base, profile: { ...base.profile, avatar: '' } }],
      ['favicon-missing', { ...base, settings: { ...base.settings, favicon: '' } }],
      ['alt-missing', { ...base, blocks: [{ id: 'b1', type: 'image', src: 'https://x/a.png', alt: '' }] }],
      ['http-links', { ...base, blocks: [{ id: 'b1', type: 'link', label: 'x', url: 'http://plain.example', icon: '' }] }],
      ['ar-links', { ...base, blocks: [{ id: 'b1', type: 'link', label: 'x', url: `https://arweave.net/${ID_A}`, icon: '' }] }],
      ['duplicate-links', { ...base, blocks: [{ id: 'b1', type: 'link', label: 'a', url: 'https://a.example', icon: '' }, { id: 'b2', type: 'link', label: 'b', url: 'https://A.example/', icon: '' }] }],
      ['empty-blocks', { ...base, blocks: [{ id: 'b1', type: 'heading', text: '  ' }, { id: 'b2', type: 'link', label: 'x', url: '', icon: '' }] }],
      ['low-contrast', { ...base, theme: { ...base.theme, text: '#1b2442' } }],
      ['accent-contrast', { ...base, theme: { ...base.theme, accent: '#101830' } }],
    ];
    for (const [id, d] of cases) {
      expect(ids(d), id).toContain(id);
      const fixed = applyOne(d, id);
      expect(ids(fixed), `${id} after apply`).not.toContain(id);
    }
  });

  it('specific fixes are the right ones', () => {
    const base = typical();
    const http = applyOne({ ...base, blocks: [{ id: 'b1', type: 'link', label: 'x', url: 'http://plain.example', icon: '' }] }, 'http-links');
    expect((http.blocks[0] as { url: string }).url).toBe('https://plain.example');
    const ar = applyOne({ ...base, blocks: [{ id: 'b1', type: 'link', label: 'x', url: `https://arweave.net/${ID_A}`, icon: '' }] }, 'ar-links');
    expect((ar.blocks[0] as { url: string }).url).toBe(`ar://${ID_A}`);
    const lc = applyOne({ ...base, theme: { ...base.theme, text: '#1b2442' } }, 'low-contrast');
    expect(lc.theme.text).toBe('#e8ecf8'); // the template's own text colour
    const dup = applyOne({ ...base, blocks: [{ id: 'b1', type: 'link', label: 'a', url: 'https://a.example', icon: '' }, { id: 'b2', type: 'link', label: 'b', url: 'https://a.example', icon: '' }] }, 'duplicate-links');
    expect(dup.blocks.map((b) => b.id)).toEqual(['b1']);
  });

  it('autofilled ar.io extension links are not flagged; known mirrors are', () => {
    const base = typical();
    expect(ids(base)).not.toContain('ar-links');
    const d = { ...base, blocks: [{ id: 'b1', type: 'link' as const, label: 'x', url: 'https://bankon.pythai.net', icon: '' }] };
    expect(ids(d)).not.toContain('ar-links');
    expect(ids(d, { known: { 'https://bankon.pythai.net': 'ar://bankon' } })).toContain('ar-links');
    expect(arEquivalent('https://docs_bankon.ar.io/x')).toBe('ar://docs_bankon/x');
    expect(arEquivalent('https://example.com')).toBeNull();
  });

  it('context rules: launch and over the free limit', () => {
    const l = suggest(typical(), { launch: true }).find((s) => s.id === 'launch')!;
    expect(l.action).toBe('launch');
    const o = suggest(typical(), { sizes: [{ path: 'avatar.webp', size: 200_000 }], freeLimit: 107_520 }).find((s) => s.id === 'over-free')!;
    expect(o.action).toBe('recompress-avatar');
    expect(ids(typical(), { sizes: [{ path: 'index.html', size: 9000 }], freeLimit: 107_520 })).not.toContain('over-free');
  });

  it('shorten cuts at a word', () => {
    expect(shorten('hello wonderful world', 18)).toBe('hello wonderful…');
    expect(shorten('hello wonderful world', 12)).toBe('hello wonde…');
    expect(shorten('short', 12)).toBe('short');
  });
});

// ── iNFT ─────────────────────────────────────────────────────────────────────

describe('iNFT metadata', () => {
  it('has the ERC-721 shape and points at the permanent ids', () => {
    const m = buildInftMetadata(typical(), { manifestId: ID_A, imageId: ID_B });
    expect(m).toMatchObject({
      name: 'BANKON',
      description: 'Permanent names and the Bitcoin wallet',
      image: `ar://${ID_B}`,
      external_url: 'https://bankon.ar.io',
      animation_url: `ar://${ID_A}`,
      storageURI: `ar://${ID_A}`,
    });
    expect(m.attributes).toEqual(expect.arrayContaining([{ trait_type: 'Version', value: 1 }, { trait_type: 'Template', value: 'midnight' }]));
    expect(() => buildInftMetadata(typical(), { manifestId: 'short' })).toThrow();
  });

  it('the mint stays disabled, with the honest reason', () => {
    expect(INFT_MINT_ENABLED).toBe(false);
    expect(INFT_MINT_REASON).toContain('cleared false');
    expect(INFT_MINT_REASON).toContain('OVERLORD');
  });
});
