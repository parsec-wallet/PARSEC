// Profiles: the default profile keeps the keys it always had, other profiles
// get their own, and switching reloads the account list without touching any
// other profile's data.

import { describe, it, expect, beforeEach } from 'vitest';

const storage = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() { return storage.size; },
};

const P = await import('../profiles');
const { store } = await import('../store');
const { walletsOf } = await import('../ui/profile-chooser');

const ALGO = 'ABIZJORUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('profile names', () => {
  it('match the Rust rule', () => {
    expect(P.validProfileName('default')).toBe(true);
    expect(P.validProfileName('payto-2')).toBe(true);
    expect(P.validProfileName('')).toBe(false);
    expect(P.validProfileName('-x')).toBe(false);
    expect(P.validProfileName('Agents')).toBe(false);
    expect(P.validProfileName('../x')).toBe(false);
    expect(P.validProfileName('a'.repeat(33))).toBe(false);
  });

  it('are made from what someone types', () => {
    expect(P.toProfileName('  My Agents ')).toBe('my-agents');
    expect(P.toProfileName('pay/to!')).toBe('payto');
    expect(P.toProfileName('--x')).toBe('x');
    expect(P.toProfileName('!!!')).toBe('');
  });
});

describe('storage keys', () => {
  beforeEach(() => storage.clear());

  it('default keeps the original keys', () => {
    expect(P.activeProfile()).toBe('default');
    expect(P.stateKey()).toBe('parsec-wallet-state');
    expect(P.webKeysKey()).toBe('parsec-encrypted-keys');
  });

  it('other profiles are suffixed', () => {
    P.setActiveProfileLocal('agents');
    expect(P.activeProfile()).toBe('agents');
    expect(P.stateKey()).toBe('parsec-wallet-state@agents');
    expect(P.webKeysKey()).toBe('parsec-encrypted-keys@agents');
    P.setActiveProfileLocal('default');
    expect(storage.has('parsec:profile')).toBe(false);
  });

  it('an invalid recorded profile reads as default', () => {
    storage.set('parsec:profile', '../etc');
    expect(P.activeProfile()).toBe('default');
  });
});

describe('store.useProfile', () => {
  it('switches account lists and leaves the default untouched', async () => {
    storage.clear();
    const original = JSON.stringify({ accounts: [{ address: ALGO, name: 'Account 1', chains: { algorand: ALGO } }], activeAccountIndex: 0 });
    storage.set('parsec-wallet-state', original);
    await store.useProfile('default', { backend: false });
    expect(store.get().accounts.map((a) => a.address)).toEqual([ALGO]);

    await store.useProfile('fresh');
    expect(store.profile).toBe('fresh');
    expect(store.get().accounts).toEqual([]);
    // A first visit inherits the settings rather than resetting them.
    expect(storage.has('parsec-wallet-state@fresh')).toBe(true);
    expect(storage.get('parsec-wallet-state')).toBe(original);

    await store.useProfile('default');
    expect(store.get().accounts.map((a) => a.address)).toEqual([ALGO]);
  });

  it('lists profiles from local storage in the browser build', async () => {
    const list = await P.listProfiles();
    expect(list.profiles.map((p) => p.name).sort()).toEqual(['default', 'fresh']);
    expect(list.profiles.find((p) => p.name === 'default')?.mirror[0].address).toBe(ALGO);
  });
});

describe('walletsOf', () => {
  it('merges the mirror with vault addresses the mirror lost', () => {
    const rows = walletsOf({
      name: 'default', exists: true,
      accounts: [{ address: ALGO, chain: 'algorand', label: 'Account 1' }, { address: 'SOLADDR', chain: 'solana', label: 'Sol' }],
      mirror: [{ name: 'Main', address: ALGO, chains: { algorand: ALGO } }],
    });
    expect(rows).toEqual([
      { label: 'Main', chain: 'algorand', address: ALGO, watchOnly: undefined },
      { label: 'Sol', chain: 'solana', address: 'SOLADDR' },
    ]);
  });
});

describe('profileFor — an address opens the vault that holds its key', () => {
  const SOL = 'So1anaAddr';
  const mk = (name: string, keys: string[], mirror: string[] = [], chains: Record<string, string> = {}) => ({
    name, exists: keys.length > 0,
    accounts: keys.map((address) => ({ address, chain: 'algorand', label: 'A' })),
    mirror: mirror.map((address) => ({ name: 'A', address, chains: { algorand: address, ...chains } })),
  });

  it('stays on the open profile when its vault has the key', () => {
    const list = { active: 'main', profiles: [mk('default', [ALGO]), mk('main', [ALGO])] };
    expect(P.profileFor(list, [ALGO])).toEqual({ name: 'main', ambiguous: [], inVault: true });
  });

  it('moves to the one other vault that has the key', () => {
    const list = { active: 'default', profiles: [mk('default', ['OTHER']), mk('agents', [ALGO])] };
    expect(P.profileFor(list, [ALGO]).name).toBe('agents');
  });

  it('asks when several other vaults hold it', () => {
    const list = { active: 'fresh', profiles: [mk('default', [ALGO]), mk('main', [ALGO]), mk('fresh', [])] };
    expect(P.profileFor(list, [ALGO])).toEqual({ name: null, ambiguous: ['default', 'main'], inVault: true });
  });

  it('prefers a vault with the key over a profile that only lists the address', () => {
    const list = { active: 'watch', profiles: [mk('watch', [], [ALGO]), mk('keys', [ALGO])] };
    expect(P.profileFor(list, [ALGO]).name).toBe('keys');
  });

  it('finds a listed chain address, and reports nothing for an unknown one', () => {
    const list = { active: 'default', profiles: [mk('default', []), mk('sol', [], [ALGO], { solana: SOL })] };
    expect(P.profileFor(list, [SOL])).toEqual({ name: 'sol', ambiguous: [], inVault: false });
    expect(P.profileFor(list, ['NOPE']).name).toBeNull();
  });
});
