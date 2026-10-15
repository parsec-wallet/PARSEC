// Autogen images — when a name has no logo (or its logo id does not resolve), the page still gets a
// face: a sigil drawn from the name, and a 1200×630 social card. Pure, offline, deterministic: the
// same name and accent always give byte-identical SVG, a couple of kilobytes each, uploaded in the
// page's own manifest so the page stays self-contained.

import { hexToRgb, hslToHex, readableOn, rgbToHsl } from './color';

/** FNV-1a, 32-bit: a stable seed from the name. Not cryptographic — it only picks shapes. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(s)) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** xorshift32 stream from a seed: the same seed, the same sequence, on every engine. */
function stream(seed: number): () => number {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x;
  };
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

export interface SigilPalette { bg: string; ring: string; mark: string; dot: string }

/** Four colours from the accent: the hue turns by an amount the name chooses. */
export function sigilPalette(name: string, accent: string): SigilPalette {
  const { h, s } = rgbToHsl(hexToRgb(accent));
  const turn = 20 + (hash32(`${name}|turn`) % 140);
  const sat = Math.max(0.45, Math.min(0.85, s || 0.6));
  return {
    bg: hslToHex(h, sat * 0.55, 0.16),
    ring: hslToHex(h, sat, 0.58),
    mark: hslToHex(h + turn, sat, 0.62),
    dot: hslToHex(h - turn / 2, sat, 0.74),
  };
}

/** The sigil's shapes (no <svg> wrapper), centred on (cx, cy) with radius `r`. */
function sigilShapes(name: string, accent: string, cx: number, cy: number, r: number): string {
  const p = sigilPalette(name, accent);
  const next = stream(hash32(name.toLowerCase()));
  const points = 5 + (next() % 5);            // 5..9 points
  const inner = 0.32 + (next() % 30) / 100;   // inner radius ratio 0.32..0.61
  const spin = next() % 360;
  const dots = 3 + (next() % 6);              // 3..8 orbiting dots
  const star: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = ((spin + (i * 180) / points) * Math.PI) / 180;
    const rr = (i % 2 === 0 ? 0.62 : 0.62 * inner) * r;
    star.push(`${r1(cx + rr * Math.cos(a))},${r1(cy + rr * Math.sin(a))}`);
  }
  const orbit: string[] = [];
  for (let i = 0; i < dots; i++) {
    const a = ((spin / 2 + (i * 360) / dots) * Math.PI) / 180;
    orbit.push(`<circle cx="${r1(cx + 0.8 * r * Math.cos(a))}" cy="${r1(cy + 0.8 * r * Math.sin(a))}" r="${r1(r * 0.055)}" fill="${p.dot}"/>`);
  }
  return [
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${p.bg}"/>`,
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r * 0.8)}" fill="none" stroke="${p.ring}" stroke-width="${r1(r * 0.03)}" opacity="0.7"/>`,
    `<polygon points="${star.join(' ')}" fill="${p.mark}" opacity="0.92"/>`,
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r * 0.12)}" fill="${p.ring}"/>`,
    ...orbit,
  ].join('');
}

/** A square avatar sigil, 512×512 viewBox. */
export function sigilSvg(name: string, accent: string): string {
  const label = escapeXml(name || 'page');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Sigil for ${label}">${sigilShapes(name, accent, 256, 256, 256)}</svg>`;
}

/** Split a line into at most `lines` lines of about `width` characters, ending in … when cut. */
export function wrapText(text: string, width: number, lines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  let cut = false;
  for (const word of words) {
    const w = word.length > width ? `${word.slice(0, width - 1)}…` : word;
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= width) { cur = cand; continue; }
    out.push(cur);
    cur = w;
    if (out.length === lines) { cut = true; cur = ''; break; }
  }
  if (cur) out.push(cur);
  if (cut) {
    const last = out[lines - 1];
    out[lines - 1] = `${last.length >= width ? last.slice(0, width - 1) : last}…`;
  }
  return out;
}

export interface CardInput {
  /** The ArNS name the page is served at (the host label: ext_name or name). */
  host: string;
  title: string;
  tagline: string;
  accent: string;
  background: { from: string; to: string };
  text: string;
  font: string;
}

/** The 1200×630 social card: sigil, title, tagline, ar://name. */
export function cardSvg(c: CardInput): string {
  const title = wrapText(c.title || c.host, 22, 2);
  const tag = wrapText(c.tagline, 44, 2);
  const fg = c.text;
  const sub = readableOn(c.background.to) === '#000000' ? '#333333' : '#d6d6d6';
  const font = escapeXml(c.font);
  const lines: string[] = [];
  let y = 250;
  for (const t of title) { lines.push(`<text x="560" y="${y}" font-size="68" font-weight="700" fill="${fg}">${escapeXml(t)}</text>`); y += 80; }
  y += 10;
  for (const t of tag) { lines.push(`<text x="560" y="${y}" font-size="34" fill="${sub}">${escapeXml(t)}</text>`); y += 46; }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" font-family="${font}" role="img" aria-label="${escapeXml(c.title || c.host)}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.background.from}"/><stop offset="1" stop-color="${c.background.to}"/></linearGradient></defs>`,
    '<rect width="1200" height="630" fill="url(#g)"/>',
    `<rect x="0" y="600" width="1200" height="30" fill="${c.accent}"/>`,
    sigilShapes(c.host, c.accent, 280, 300, 200),
    ...lines,
    `<text x="560" y="540" font-size="30" fill="${c.accent}">ar://${escapeXml(c.host)}</text>`,
    '</svg>',
  ].join('');
}

/** Initials for the no-image fallback: up to two letters from the display name or the name. */
export function initials(s: string): string {
  const parts = s.trim().split(/[\s_-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
