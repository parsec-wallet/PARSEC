import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PROFILE_KEY,
  deleteProfile,
  differsFrom,
  FOCUS_CATALOG,
  getActiveProfile,
  isParsecSeeded,
  seedParsecProfile,
  listProfiles,
  PARSEC_PROFILE,
  PARSEC_PROFILE_ID,
  PROFILES_KEY,
  profileIdFor,
  sanitizeProfile,
  saveProfileAs,
  setActiveProfile,
  updateProfile,
  type ProfileStorage,
} from '../diag-profiles';

function memStorage(seed: Record<string, string> = {}): ProfileStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

const choices = () => ({
  focus: ['bitcoin', 'algorand'],
  depth: 'advanced' as const,
  period: '1h' as const,
  scene: { ...PARSEC_PROFILE.scene, cryptocloud: true },
  panels: { ...PARSEC_PROFILE.panels, news: true },
  watch: [{ chain: 'algorand' as const, address: 'ABIZJORU6VRN4U5G2WZX2DEZ2WBWKWRRCTHCWH2TRMG3ZYAOCDNRNSWKHA', label: 'Main' }],
});

describe('the PARSEC default', () => {
  it('emphasises the twelve chains in the stated order, Algorand first', () => {
    const syms = PARSEC_PROFILE.focus.map((id) => FOCUS_CATALOG.find((a) => a.id === id)!.symbol);
    expect(syms).toEqual(['ALGO', 'AR', 'SOL', 'BTC', 'ETH', 'HYPE', 'ARB', 'OP', 'POL', 'INJ', '0G', 'BLAST']);
  });

  it('is active on a fresh device', () => {
    const s = memStorage();
    expect(getActiveProfile(s).id).toBe(PARSEC_PROFILE_ID);
    expect(listProfiles(s).map((p) => p.id)).toEqual([PARSEC_PROFILE_ID]);
  });

  it('cannot be deleted', () => {
    const s = memStorage();
    expect(() => deleteProfile(PARSEC_PROFILE_ID, s)).toThrow(/built in/);
  });

  it('is seeded once from the participant\'s own selections, keeping the PARSEC emphasis', () => {
    const s = memStorage();
    expect(isParsecSeeded(s)).toBe(false);
    const mine = { ...choices(), focus: [...PARSEC_PROFILE.focus], scene: { ...PARSEC_PROFILE.scene, top10: true, stablecoins: true } };
    const p = seedParsecProfile(mine, s);
    expect(p.id).toBe(PARSEC_PROFILE_ID);
    expect(p.builtin).toBe(true);
    expect(p.scene.top10).toBe(true);
    expect(p.scene.stablecoins).toBe(true);
    expect(p.depth).toBe('advanced');
    expect(p.focus[0]).toBe('algorand');
    expect(getActiveProfile(s).id).toBe(PARSEC_PROFILE_ID);
    // A second seed never overwrites the first.
    seedParsecProfile({ ...mine, depth: 'basic' }, s);
    expect(getActiveProfile(s).depth).toBe('advanced');
  });

  it('can be saved over, which rewrites the seed', () => {
    const s = memStorage();
    seedParsecProfile(choices(), s);
    updateProfile(PARSEC_PROFILE_ID, { ...choices(), period: '7d' }, s);
    expect(getActiveProfile(s).period).toBe('7d');
    expect(getActiveProfile(s).builtin).toBe(true);
  });

  it('is handed out as a copy, so a caller cannot mutate the default', () => {
    const s = memStorage();
    getActiveProfile(s).focus.push('aave');
    expect(getActiveProfile(s).focus).not.toContain('aave');
  });
});

describe('saving and switching', () => {
  it('saves a new profile, makes it active, and persists only own profiles', () => {
    const s = memStorage();
    const p = saveProfileAs('Night desk', choices(), s);
    expect(p.id).toBe('night-desk');
    expect(getActiveProfile(s).name).toBe('Night desk');
    const stored = JSON.parse(s.data.get(PROFILES_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].builtin).toBe(false);
  });

  it('gives each saved name a unique id, never "parsec"', () => {
    expect(profileIdFor('PARSEC', new Set(['parsec']))).toBe('parsec-copy');
    expect(profileIdFor('Desk', new Set(['desk']))).toBe('desk-2');
    expect(profileIdFor('!!!', new Set())).toBe('profile');
  });

  it('updates a saved profile in place', () => {
    const s = memStorage();
    const p = saveProfileAs('Desk', choices(), s);
    updateProfile(p.id, { ...choices(), focus: ['ethereum'] }, s);
    expect(listProfiles(s).find((x) => x.id === p.id)!.focus).toEqual(['ethereum']);
  });

  it('falls back to PARSEC when the active profile is deleted', () => {
    const s = memStorage();
    const p = saveProfileAs('Desk', choices(), s);
    deleteProfile(p.id, s);
    expect(s.data.get(ACTIVE_PROFILE_KEY)).toBe(PARSEC_PROFILE_ID);
    expect(getActiveProfile(s).id).toBe(PARSEC_PROFILE_ID);
  });

  it('ignores an active id that names nothing', () => {
    const s = memStorage();
    expect(setActiveProfile('ghost', s).id).toBe(PARSEC_PROFILE_ID);
  });
});

describe('sanitizeProfile', () => {
  it('drops unknown assets and repairs bad fields from storage', () => {
    const p = sanitizeProfile({
      id: 'x', name: '  X  ', focus: ['algorand', 'evil-coin', 'algorand', 7],
      depth: 'root', period: '3d', scene: { matrix: 'yes', pyramid: false }, panels: null,
    })!;
    expect(p.name).toBe('X');
    expect(p.focus).toEqual(['algorand']);
    expect(p.depth).toBe(PARSEC_PROFILE.depth);
    expect(p.period).toBe(PARSEC_PROFILE.period);
    expect(p.scene.matrix).toBe(PARSEC_PROFILE.scene.matrix);
    expect(p.scene.pyramid).toBe(false);
    expect(p.panels).toEqual(PARSEC_PROFILE.panels);
  });

  it('refuses a stored profile that claims to be PARSEC or has a hostile id', () => {
    expect(sanitizeProfile({ id: 'parsec', name: 'PARSEC' })).toBeNull();
    expect(sanitizeProfile({ id: '../x', name: 'x' })).toBeNull();
    expect(sanitizeProfile('nope')).toBeNull();
  });

  it('survives corrupt storage', () => {
    const s = memStorage({ [PROFILES_KEY]: '{not json' });
    expect(listProfiles(s).map((p) => p.id)).toEqual([PARSEC_PROFILE_ID]);
  });
});

describe('differsFrom', () => {
  it('spots a change in any choice and ignores key order', () => {
    const base = { ...PARSEC_PROFILE, focus: [...PARSEC_PROFILE.focus] };
    const same = {
      focus: [...base.focus], depth: base.depth, period: base.period,
      scene: { ...base.scene }, panels: { ...base.panels }, watch: [...base.watch],
    };
    expect(differsFrom(base, same)).toBe(false);
    expect(differsFrom(base, { ...same, period: '7d' })).toBe(true);
    expect(differsFrom(base, { ...same, focus: [...same.focus].reverse() })).toBe(true);
    expect(differsFrom(base, { ...same, panels: { ...same.panels, news: true } })).toBe(true);
    expect(differsFrom(base, { ...same, watch: [{ chain: 'evm', address: '0x' + 'a'.repeat(40), label: '' }] })).toBe(true);
  });
});

describe('watched wallets in a profile', () => {
  it('keeps valid entries and drops malformed, duplicate and overflow ones', () => {
    const algo = 'ABIZJORU6VRN4U5G2WZX2DEZ2WBWKWRRCTHCWH2TRMG3ZYAOCDNRNSWKHA';
    const p = sanitizeProfile({
      id: 'w', name: 'W',
      watch: [
        { chain: 'algorand', address: algo, label: 'Main' },
        { chain: 'algorand', address: algo, label: 'dup' },
        { chain: 'evm', address: 'not-an-address' },
        { chain: 'dogecoin', address: 'x' },
        ...Array.from({ length: 40 }, (_, i) => ({ chain: 'evm', address: '0x' + i.toString(16).padStart(40, '0') })),
      ],
    })!;
    expect(p.watch[0]).toEqual({ chain: 'algorand', address: algo, label: 'Main' });
    expect(p.watch.filter((w) => w.address === algo)).toHaveLength(1);
    expect(p.watch.some((w) => w.address === 'not-an-address')).toBe(false);
    expect(p.watch.length).toBe(25);
  });
});
