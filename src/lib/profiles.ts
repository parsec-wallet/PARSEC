// PARSEC Wallet — profiles: several vaults on one device, one open at a time.
//
// A profile is a vault plus the wallets kept in it. The profile named
// `default` is the vault and wallet list that existed before profiles did —
// same directory (`app_data_dir/bankon_vault`), same localStorage key
// (`parsec-wallet-state`) — so nothing moves when profiles arrive.
//
// Every other profile has its own vault directory (`app_data_dir/vaults/<name>`,
// chosen in Rust: bankon_vault/profiles.rs) and its own account mirror
// (`parsec-wallet-state@<name>`). Choosing a profile locks the open session.
//
// A forgotten passphrase is answered here, not by deleting anything: make a new
// profile, restore the wallets into it from their recovery phrases, and the old
// vault stays where it is, under its own name, in case the passphrase returns.
//
// This module holds no secret and imports nothing that does. The store reads
// `stateKey()` from it; the web keystore reads `webKeysKey()`.

import { invoke, isTauri } from './platform';

export const DEFAULT_PROFILE = 'default';
const ACTIVE_KEY = 'parsec:profile';
const STATE_BASE = 'parsec-wallet-state';
const WEB_KEYS_BASE = 'parsec-encrypted-keys';

export interface ProfileAccount { address: string; chain: string; label: string }

export interface ProfileInfo {
  name: string;
  /** A vault exists for this profile (desktop: on disk; browser: keys saved). */
  exists: boolean;
  /** Public addresses the vault holds — read without a passphrase, no secrets. */
  accounts: ProfileAccount[];
  /** Account names and addresses from this profile's local mirror, which also
   *  carries watch-only accounts and the chain map the vault does not. */
  mirror: { name: string; address: string; chains: Record<string, string>; watchOnly?: boolean }[];
}

export interface ProfileList { active: string; profiles: ProfileInfo[] }

/** Lowercase letters, digits, `-` and `_`; starts with a letter or digit; ≤ 32. Same rule as Rust. */
export function validProfileName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name);
}

/** Turn what someone typed into a profile name, or '' if nothing usable is left. */
export function toProfileName(typed: string): string {
  return typed.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').replace(/^[-_]+/, '').slice(0, 32);
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** The profile this window is using. */
export function activeProfile(): string {
  const v = read(ACTIVE_KEY);
  return v && validProfileName(v) ? v : DEFAULT_PROFILE;
}

function keyFor(base: string, name: string): string {
  return name === DEFAULT_PROFILE ? base : `${base}@${name}`;
}

/** localStorage key of a profile's account mirror (never holds a secret). */
export function stateKey(name: string = activeProfile()): string {
  return keyFor(STATE_BASE, name);
}

/** localStorage key of the browser build's encrypted keys for a profile. */
export function webKeysKey(name: string = activeProfile()): string {
  return keyFor(WEB_KEYS_BASE, name);
}

/** Record `name` as this window's profile. Callers reload state after. */
export function setActiveProfileLocal(name: string): void {
  try {
    if (name === DEFAULT_PROFILE) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, name);
  } catch { /* storage unavailable: the profile lasts for this window only */ }
}

function mirrorOf(name: string): ProfileInfo['mirror'] {
  try {
    const raw = read(stateKey(name));
    if (!raw) return [];
    const saved = JSON.parse(raw) as { accounts?: unknown };
    if (!Array.isArray(saved.accounts)) return [];
    return saved.accounts.map((a: { name?: string; address?: string; chains?: Record<string, string>; watchOnly?: boolean }) => ({
      name: a.name ?? 'Account',
      address: a.address ?? '',
      chains: a.chains && typeof a.chains === 'object' ? a.chains : {},
      watchOnly: a.watchOnly,
    })).filter((a) => a.address);
  } catch {
    return [];
  }
}

/** Profiles the browser build knows of: those with a mirror or saved keys. */
function localNames(): string[] {
  const names = new Set<string>([DEFAULT_PROFILE, activeProfile()]);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      for (const base of [STATE_BASE, WEB_KEYS_BASE]) {
        if (k.startsWith(`${base}@`)) {
          const n = k.slice(base.length + 1);
          if (validProfileName(n)) names.add(n);
        }
      }
    }
  } catch { /* storage unavailable */ }
  return [...names];
}

/**
 * Every profile, with its vault state and the public addresses in it.
 * Desktop asks Rust (the vault directories are the record); the browser build
 * reads its own storage. Never throws: an unreadable answer lists `default`.
 */
export async function listProfiles(): Promise<ProfileList> {
  if (isTauri) {
    try {
      const r = await invoke<{ active: string; profiles: { name: string; exists: boolean; accounts: ProfileAccount[] }[] }>('vault_profiles');
      return {
        active: r.active,
        profiles: r.profiles.map((p) => ({ ...p, mirror: mirrorOf(p.name) })),
      };
    } catch {
      /* a build without profiles: fall through to the local view */
    }
  }
  return {
    active: activeProfile(),
    profiles: localNames().map((name) => ({
      name,
      exists: !!read(webKeysKey(name)) || (isTauri && name === DEFAULT_PROFILE),
      accounts: [],
      mirror: mirrorOf(name),
    })),
  };
}

/**
 * Point the vault at `name` (desktop: Rust records it and locks the session).
 * Does not touch the store — `store.useProfile()` calls this and then reloads.
 */
export async function selectProfileBackend(name: string): Promise<void> {
  if (!validProfileName(name)) throw new Error('Profile names use lowercase letters, digits, - and _ (at most 32 characters).');
  if (isTauri) await invoke('vault_profile_select', { name });
  setActiveProfileLocal(name);
}

/**
 * The desktop records the active profile on disk; this window records it in
 * localStorage. If they disagree (storage cleared, another window switched),
 * the disk wins. Returns the profile to use, or null when they already agree.
 */
export async function reconcileProfile(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const r = await invoke<{ active: string }>('vault_profiles');
    if (r.active && validProfileName(r.active) && r.active !== activeProfile()) return r.active;
  } catch { /* a build without profiles: nothing to reconcile */ }
  return null;
}

/** Short form of an address for one-line lists. */
export function shortAddress(a: string): string {
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}
