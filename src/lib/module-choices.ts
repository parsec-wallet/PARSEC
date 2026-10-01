// PARSEC Wallet — Module Choices
//
// What a module elects, stated once and in one place. A module declares the
// most it will ever ask of the wallet (privilege), whether its readings leave
// the device (reach), what it keeps between sessions (persistence), and
// whether it depends on anything outside PARSEC (provider).
//
// This is an honesty contract in the same spirit as lib/ui/provenance.ts: a
// module says up front what it does, the UI can state it in place, and a
// module that tries to exceed its own declaration fails loudly here instead
// of silently escalating. It is not a security boundary — the frontend
// classifies and suggests, the Rust side verifies and decides — and nothing
// in this file should be read as one.
//
// Kept free of imports beyond a type so it can be tested in plain Node and
// pulled into any module without dragging the router or the store along.

import type { Reach } from './ui/provenance';
import { REACH_WORD } from './ui/provenance';

/**
 * The privilege ladder, lowest first. A module may only call into the wallet
 * at or below the rung it declared.
 *
 *   observe — reads public state. Never sees a key, never asks for a signature.
 *   sign    — may ask the Rust signer for a signature over the active account.
 *             Still never sees a key: `*_sign_*` returns a signature.
 *   vault   — may create or import entries through bankon_vault.
 *   system  — may call OS-privileged commands. Diagnostics' MAC spoof is the
 *             precedent; the backend surfaces a permission error unprivileged.
 */
export type Privilege = 'observe' | 'sign' | 'vault' | 'system';

/** What a module keeps between sessions. `vault` means through bankon_vault only. */
export type Persistence = 'none' | 'device' | 'vault';

/**
 * Whether the module leans on anything outside PARSEC.
 *
 *   none              — works with nothing but this wallet.
 *   local             — ships a local default and needs nothing else to function.
 *   optional-external — may use an external service the participant chose in
 *                       Settings; degrades to `unknown` when it is absent
 *                       (docs/modules.md rule 6 — absence is not a fault).
 */
export type ProviderChoice = 'none' | 'local' | 'optional-external';

export interface ModuleChoices {
  readonly privilege: Privilege;
  readonly reach: Reach;
  readonly persistence: Persistence;
  readonly provider: ProviderChoice;
}

export const PRIVILEGE_RANK: Readonly<Record<Privilege, number>> = {
  observe: 0,
  sign: 1,
  vault: 2,
  system: 3,
};

export const PRIVILEGE_WORD: Readonly<Record<Privilege, string>> = {
  observe: 'observe — reads public state; never sees a key, never asks for a signature',
  sign: 'sign — may request a signature from the Rust signer; never sees a key',
  vault: 'vault — may create or import entries through bankon_vault',
  system: 'system — may call OS-privileged commands',
};

export const PERSISTENCE_WORD: Readonly<Record<Persistence, string>> = {
  none: 'keeps nothing between sessions',
  device: 'keeps a preference on this device (never a secret)',
  vault: 'keeps material in bankon_vault only',
};

export const PROVIDER_WORD: Readonly<Record<ProviderChoice, string>> = {
  none: 'needs nothing outside PARSEC',
  local: 'ships a local default; needs nothing else to work',
  'optional-external': 'may use an external service you choose; unknown when it is absent',
};

/**
 * The cautious defaults for a module that declares nothing: lowest privilege,
 * and — as with provenance — assume a reading leaves the device unless the
 * module says otherwise, because the opposite mistake has consequences.
 */
export const DEFAULT_CHOICES: ModuleChoices = {
  privilege: 'observe',
  reach: 'external',
  persistence: 'none',
  provider: 'none',
};

/** Four plain sentences a view can print under its title. */
export function describeChoices(c: ModuleChoices): string[] {
  return [
    `privilege: ${PRIVILEGE_WORD[c.privilege]}`,
    `reach: readings come from ${REACH_WORD[c.reach]}`,
    `persistence: ${PERSISTENCE_WORD[c.persistence]}`,
    `provider: ${PROVIDER_WORD[c.provider]}`,
  ];
}

export function hasPrivilege(c: ModuleChoices, needed: Privilege): boolean {
  return PRIVILEGE_RANK[c.privilege] >= PRIVILEGE_RANK[needed];
}

export class PrivilegeError extends Error {
  constructor(
    readonly moduleId: string,
    readonly declared: Privilege,
    readonly needed: Privilege,
  ) {
    super(
      `module "${moduleId}" declared privilege "${declared}" and may not "${needed}"; ` +
        'raise its declaration in its ParsecModule.choices, do not bypass it',
    );
    this.name = 'PrivilegeError';
  }
}

/** Throw unless the module's declaration covers what it is about to do. */
export function assertPrivilege(moduleId: string, c: ModuleChoices, needed: Privilege): void {
  if (!hasPrivilege(c, needed)) throw new PrivilegeError(moduleId, c.privilege, needed);
}
