// PARSEC Wallet — Blue Pill diagnostics profiles
//
// The Blue Pill is diagnostics, and control of diagnostics: what the landing
// shows, how deep the instruments go, which extensions are on, which period
// every percentage is measured over, and which assets are emphasised. A profile
// is a named snapshot of those choices.
//
// PARSEC is the built-in default. Its emphasis is fixed in code — Algorand
// first, then the chains PARSEC carries — but its switches are the
// participant's own: the first time profiles run on a device, PARSEC is seeded
// from the selections already in place (landing toggles, extension switches,
// depth, period), so introducing profiles changes nothing on screen. PARSEC
// can be saved over but never deleted; "save as" makes further profiles.
//
// Profiles are participant preferences — no keys, no addresses, no balances —
// so localStorage is the right home, as it is for lib/nav.ts disclosure. They
// survive a Red Pill logout on purpose: logging out ends a wallet session, it
// does not forget how the participant likes to read the market.

import { CHANGE_PERIODS, type ChangePeriod } from './prices';
import { sanitizeWatched, type WatchedWallet } from './watch';

// ── Assets that can be emphasised ────────────────────────────────────────────

export interface FocusAsset {
  /** CoinGecko id — the key everything else is looked up by. */
  id: string;
  symbol: string;
  name: string;
  /** Bybit USDT linear perpetual base, when one exists. */
  perp?: string;
  /** DeFiLlama chain name, when the asset has a chain with DeFi TVL. */
  llamaChain?: string;
}

/**
 * Every asset a profile can emphasise. Identifiers verified against CoinGecko,
 * Bybit and DeFiLlama on 2026-09-25. Arweave has no DeFiLlama chain entry.
 */
export const FOCUS_CATALOG: ReadonlyArray<FocusAsset> = [
  { id: 'algorand', symbol: 'ALGO', name: 'Algorand', perp: 'ALGO', llamaChain: 'Algorand' },
  { id: 'arweave', symbol: 'AR', name: 'Arweave', perp: 'AR' },
  { id: 'solana', symbol: 'SOL', name: 'Solana', perp: 'SOL', llamaChain: 'Solana' },
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', perp: 'BTC', llamaChain: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', perp: 'ETH', llamaChain: 'Ethereum' },
  { id: 'hyperliquid', symbol: 'HYPE', name: 'Hyperliquid', perp: 'HYPE', llamaChain: 'Hyperliquid L1' },
  { id: 'arbitrum', symbol: 'ARB', name: 'Arbitrum', perp: 'ARB', llamaChain: 'Arbitrum' },
  { id: 'optimism', symbol: 'OP', name: 'Optimism', perp: 'OP', llamaChain: 'OP Mainnet' },
  { id: 'polygon-ecosystem-token', symbol: 'POL', name: 'Polygon', perp: 'POL', llamaChain: 'Polygon' },
  { id: 'injective-protocol', symbol: 'INJ', name: 'Injective', perp: 'INJ', llamaChain: 'Injective' },
  { id: 'zero-gravity', symbol: '0G', name: '0G', perp: '0G', llamaChain: '0G' },
  { id: 'blast', symbol: 'BLAST', name: 'Blast', perp: 'BLAST', llamaChain: 'Blast' },
  // Available to add, not in the PARSEC default.
  { id: 'ar-io-network', symbol: 'ARIO', name: 'AR.IO' },
  { id: 'blockstack', symbol: 'STX', name: 'Stacks', perp: 'STX', llamaChain: 'Stacks' },
  { id: 'aave', symbol: 'AAVE', name: 'Aave', perp: 'AAVE' },
  { id: 'pyth-network', symbol: 'PYTH', name: 'Pyth Network', perp: 'PYTH' },
];

const CATALOG_BY_ID = new Map(FOCUS_CATALOG.map((a) => [a.id, a]));

export function focusAsset(id: string): FocusAsset | undefined {
  return CATALOG_BY_ID.get(id);
}

// ── Profile shape ────────────────────────────────────────────────────────────

export type DiagDepth = 'basic' | 'scientific' | 'advanced';

/** Landing-page layers. Keys match the toggle stack. */
export interface SceneChoices {
  matrix: boolean;
  cryptocloud: boolean;
  top10: boolean;
  favourites: boolean;
  stablecoins: boolean;
  pyramid: boolean;
}

/** Blue Pill extension panels. Keys match the extension switches. */
export interface PanelChoices {
  arweave: boolean;
  ario: boolean;
  chainmarketcap: boolean;
  prices: boolean;
  news: boolean;
}

export interface DiagProfile {
  id: string;
  name: string;
  builtin: boolean;
  /** CoinGecko ids, in order of emphasis. */
  focus: string[];
  depth: DiagDepth;
  period: ChangePeriod;
  scene: SceneChoices;
  panels: PanelChoices;
  /**
   * Wallets this profile watches. Read-only: the Blue Pill reads their public
   * balances and never signs, sends or connects for them.
   */
  watch: WatchedWallet[];
}

/** Most wallets one profile watches — each costs a read per refresh. */
export const MAX_WATCHED = 25;

export const PARSEC_PROFILE_ID = 'parsec';

/**
 * The code default, used only until the device's own PARSEC seed exists (and
 * as the fallback if that seed is unreadable). The seed replaces every field
 * but the id, name and builtin flag.
 */
export const PARSEC_PROFILE: Readonly<DiagProfile> = Object.freeze({
  id: PARSEC_PROFILE_ID,
  name: 'PARSEC',
  builtin: true,
  focus: [
    'algorand', 'arweave', 'solana', 'bitcoin', 'ethereum', 'hyperliquid',
    'arbitrum', 'optimism', 'polygon-ecosystem-token', 'injective-protocol',
    'zero-gravity', 'blast',
  ],
  depth: 'scientific',
  period: '24h',
  scene: { matrix: true, cryptocloud: false, top10: false, favourites: true, stablecoins: false, pyramid: true },
  panels: { arweave: true, ario: false, chainmarketcap: false, prices: true, news: false },
  watch: [],
});

// ── Storage ──────────────────────────────────────────────────────────────────

export const PROFILES_KEY = 'parsec:diag-profiles';
/** The device's own PARSEC choices, seeded once from the participant's selections. */
export const PARSEC_SEED_KEY = 'parsec:diag-profile-parsec';
export const ACTIVE_PROFILE_KEY = 'parsec:diag-profile-active';

/** The subset of Storage this module uses, so tests can pass a Map-backed one. */
export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): ProfileStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

const DEPTHS: ReadonlySet<string> = new Set(['basic', 'scientific', 'advanced']);

function bools<T extends object>(raw: unknown, fallback: T): T {
  const out = { ...fallback };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(fallback) as Array<keyof T>) {
      const v = (raw as Record<string, unknown>)[k as string];
      if (typeof v === 'boolean') out[k] = v as T[keyof T];
    }
  }
  return out;
}

/**
 * A stored profile, made safe to use, or null.
 *
 * Unknown focus ids are dropped rather than trusted: storage is writable by
 * anything running on this origin, and a profile only ever names assets from
 * the catalog. Missing fields fall back to the PARSEC default.
 */
export function sanitizeProfile(raw: unknown): DiagProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : null;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 40) : '';
  if (!id || !name || id === PARSEC_PROFILE_ID) return null;
  return { id, name, builtin: false, ...sanitizeChoices(r) };
}

/** The choice fields of a stored profile, repaired field by field. */
function sanitizeChoices(r: Record<string, unknown>): Omit<DiagProfile, 'id' | 'name' | 'builtin'> {
  const focus = Array.isArray(r.focus)
    ? [...new Set(r.focus.filter((f): f is string => typeof f === 'string' && CATALOG_BY_ID.has(f)))]
    : [...PARSEC_PROFILE.focus];
  return {
    focus,
    depth: typeof r.depth === 'string' && DEPTHS.has(r.depth) ? r.depth as DiagDepth : PARSEC_PROFILE.depth,
    period: typeof r.period === 'string' && (CHANGE_PERIODS as readonly string[]).includes(r.period)
      ? r.period as ChangePeriod : PARSEC_PROFILE.period,
    scene: bools(r.scene, PARSEC_PROFILE.scene),
    panels: bools(r.panels, PARSEC_PROFILE.panels),
    watch: sanitizeWatchList(r.watch),
  };
}

/** A stored watch list: each entry sanitised, duplicates and overflow dropped. */
function sanitizeWatchList(raw: unknown): WatchedWallet[] {
  const out: WatchedWallet[] = [];
  if (!Array.isArray(raw)) return out;
  for (const w of raw) {
    const clean = sanitizeWatched(w);
    if (clean && !out.some((o) => o.chain === clean.chain && o.address === clean.address)) out.push(clean);
    if (out.length >= MAX_WATCHED) break;
  }
  return out;
}

/** PARSEC as this device knows it: the seed when there is one, else the code default. */
function cloneParsec(storage: ProfileStorage | null = defaultStorage()): DiagProfile {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(PARSEC_SEED_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      return { id: PARSEC_PROFILE_ID, name: PARSEC_PROFILE.name, builtin: true, ...sanitizeChoices(raw as Record<string, unknown>) };
    }
  } catch { /* unreadable seed — the code default stands */ }
  return {
    ...PARSEC_PROFILE,
    focus: [...PARSEC_PROFILE.focus],
    scene: { ...PARSEC_PROFILE.scene },
    panels: { ...PARSEC_PROFILE.panels },
    watch: [],
  };
}

/** Whether this device's PARSEC profile has been seeded yet. */
export function isParsecSeeded(storage = defaultStorage()): boolean {
  try { return storage?.getItem(PARSEC_SEED_KEY) != null; } catch { return true; }
}

/**
 * Seed PARSEC from the participant's current selections and make it active.
 * Runs once per device, the first time profiles exist; never overwrites a seed.
 */
export function seedParsecProfile(
  choices: Omit<DiagProfile, 'id' | 'name' | 'builtin'>,
  storage = defaultStorage(),
): DiagProfile {
  if (!isParsecSeeded(storage)) {
    const clean = sanitizeChoices(choices as unknown as Record<string, unknown>);
    try { storage?.setItem(PARSEC_SEED_KEY, JSON.stringify(clean)); } catch { /* best effort */ }
    try { storage?.setItem(ACTIVE_PROFILE_KEY, PARSEC_PROFILE_ID); } catch { /* best effort */ }
  }
  return cloneParsec(storage);
}

/** PARSEC first, then the participant's own profiles in the order saved. */
export function listProfiles(storage = defaultStorage()): DiagProfile[] {
  const own: DiagProfile[] = [];
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(PROFILES_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      for (const p of parsed) {
        const clean = sanitizeProfile(p);
        if (clean && !own.some((o) => o.id === clean.id)) own.push(clean);
      }
    }
  } catch { /* unreadable storage reads as no saved profiles */ }
  return [cloneParsec(storage), ...own];
}

function writeOwn(profiles: DiagProfile[], storage: ProfileStorage | null): void {
  const own = profiles.filter((p) => !p.builtin);
  try { storage?.setItem(PROFILES_KEY, JSON.stringify(own)); } catch { /* best effort */ }
}

export function getProfile(id: string, storage = defaultStorage()): DiagProfile | undefined {
  return listProfiles(storage).find((p) => p.id === id);
}

/** The active profile. Falls back to PARSEC when none is set or it was deleted. */
export function getActiveProfile(storage = defaultStorage()): DiagProfile {
  let id: string | null = null;
  try { id = storage?.getItem(ACTIVE_PROFILE_KEY) ?? null; } catch { /* fall back */ }
  return (id ? getProfile(id, storage) : undefined) ?? cloneParsec(storage);
}

export function setActiveProfile(id: string, storage = defaultStorage()): DiagProfile {
  const p = getProfile(id, storage) ?? cloneParsec(storage);
  try { storage?.setItem(ACTIVE_PROFILE_KEY, p.id); } catch { /* best effort */ }
  return p;
}

/** A URL-safe id derived from a name, unique among existing profiles. */
export function profileIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'profile';
  let id = base === PARSEC_PROFILE_ID ? `${base}-copy` : base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Save choices under a new name. Returns the saved profile, which becomes active.
 * Always creates: this is how the built-in PARSEC profile is customised.
 */
export function saveProfileAs(
  name: string,
  choices: Omit<DiagProfile, 'id' | 'name' | 'builtin'>,
  storage = defaultStorage(),
): DiagProfile {
  const all = listProfiles(storage);
  const clean = sanitizeProfile({
    ...choices,
    id: profileIdFor(name, new Set(all.map((p) => p.id))),
    name: name.trim() || 'Profile',
  });
  if (!clean) throw new Error('That profile could not be saved.');
  writeOwn([...all, clean], storage);
  setActiveProfile(clean.id, storage);
  return clean;
}

/** Overwrite a profile's choices. PARSEC included: saving over it rewrites the seed. */
export function updateProfile(
  id: string,
  choices: Omit<DiagProfile, 'id' | 'name' | 'builtin'>,
  storage = defaultStorage(),
): DiagProfile {
  if (id === PARSEC_PROFILE_ID) {
    const clean = sanitizeChoices(choices as unknown as Record<string, unknown>);
    try { storage?.setItem(PARSEC_SEED_KEY, JSON.stringify(clean)); } catch { /* best effort */ }
    return cloneParsec(storage);
  }
  const all = listProfiles(storage);
  const existing = all.find((p) => p.id === id);
  if (!existing) throw new Error('No saved profile by that id.');
  const clean = sanitizeProfile({ ...choices, id, name: existing.name });
  if (!clean) throw new Error('That profile could not be saved.');
  writeOwn(all.map((p) => (p.id === id ? clean : p)), storage);
  return clean;
}

/** Delete a saved profile. PARSEC cannot be deleted. Active falls back to PARSEC. */
export function deleteProfile(id: string, storage = defaultStorage()): void {
  if (id === PARSEC_PROFILE_ID) throw new Error('The PARSEC profile is built in and cannot be deleted.');
  const all = listProfiles(storage);
  writeOwn(all.filter((p) => p.id !== id), storage);
  try {
    if (storage?.getItem(ACTIVE_PROFILE_KEY) === id) storage.setItem(ACTIVE_PROFILE_KEY, PARSEC_PROFILE_ID);
  } catch { /* best effort */ }
}

/** Whether current choices differ from a profile — drives the "unsaved" mark. */
export function differsFrom(p: DiagProfile, choices: Omit<DiagProfile, 'id' | 'name' | 'builtin'>): boolean {
  const sameFlags = (a: object, b: object) => {
    const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    return [...keys].every((k) => ra[k] === rb[k]);
  };
  return p.depth !== choices.depth
    || p.period !== choices.period
    || p.focus.length !== choices.focus.length
    || p.focus.some((f, i) => choices.focus[i] !== f)
    || !sameFlags(p.scene, choices.scene)
    || !sameFlags(p.panels, choices.panels)
    || p.watch.length !== choices.watch.length
    || p.watch.some((w, i) => {
      const c = choices.watch[i];
      return !c || c.chain !== w.chain || c.address !== w.address || c.label !== w.label;
    });
}
