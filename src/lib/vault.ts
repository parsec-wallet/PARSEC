// PARSEC Wallet — bankon_vault IPC client
// All vault operations go through Tauri invoke → Rust.
// Secrets never persist in JS. They pass through briefly for signing only.

import { invoke } from './platform';

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  accounts: { address: string; chain: string; label: string }[];
  /** The active profile (see lib/profiles.ts). */
  profile?: string;
}

/** Check if vault exists and its lock state */
export async function vaultStatus(): Promise<VaultStatus> {
  return await invoke<VaultStatus>('vault_status');
}

/** Create a new vault with passphrase */
export async function vaultCreate(passphrase: string): Promise<void> {
  await invoke('vault_create', { passphrase });
}

/** Unlock the vault — starts session, key held in Rust memory */
export async function vaultUnlock(passphrase: string): Promise<void> {
  await invoke('vault_unlock', { passphrase });
}

/** Lock the vault — zeroizes session key in Rust */
export async function vaultLock(): Promise<void> {
  await invoke('vault_lock');
}

/** Store an encrypted mnemonic/key for an account */
export async function vaultStoreKey(
  address: string,
  chain: string,
  label: string,
  secret: string,
): Promise<void> {
  await invoke('vault_store_key', { address, chain, label, secret });
}

/**
 * Export a secret (recovery phrase, Arweave JWK, Solana key) for backup.
 *
 * The one place a secret leaves the PARSEC Keycore. The vault must be unlocked, the
 * passphrase is asked for again and checked (attempt-limited), and `confirm` must be the
 * address being exported — typed by the person, not filled in by the app.
 */
export async function vaultExportSecret(
  address: string,
  passphrase: string,
  confirm: string,
): Promise<{ secret: string; chain: string }> {
  return await invoke('vault_export_secret', { args: { address, passphrase, confirm } });
}

/**
 * The backup phrase of an account the PARSEC Keycore created in this session, once.
 *
 * For the backup step right after creation, so a new wallet's phrase can be written down
 * without asking for the passphrase again. Refused for any other account (use
 * `vaultExportSecret`), after the first reveal, after ten minutes, and after lock.
 */
export async function vaultRevealNew(address: string): Promise<{ secret: string; chain: string }> {
  return await invoke('vault_reveal_new', { address });
}

/** Remove an account from the vault */
export async function vaultRemoveAccount(address: string): Promise<void> {
  await invoke('vault_remove_account', { address });
}

/** List accounts (no secrets) */
export async function vaultListAccounts(): Promise<
  { address: string; chain: string; label: string; created_at: number }[]
> {
  return await invoke('vault_list_accounts');
}

/** Destroy the vault — requires passphrase confirmation */
export async function vaultDestroy(passphrase: string): Promise<void> {
  await invoke('vault_destroy', { passphrase });
}

// ── bankon-vault/2 ────────────────────────────────────────────────────────
//
// Typed wrappers for the 18 commands in src-tauri/src/bankon_vault/commands_v2.rs.
// That backend is in the tree but not yet compiled in: bankon_vault/mod.rs does
// not declare it, lib.rs does not register its commands, and VaultSession has
// no v2 state. Since 0.2.7 it is: VAULT_V2_IN_BUILD is true, new vaults are v2, and a v1
// vault migrates on its next unlock. The flag stays so a build without v2 degrades as below:
//   - reads degrade: vaultV2Status() reports the v1 vault honestly, the plan
//     says no migration is possible, the KDF and auto-lock read as unavailable;
//   - writes refuse with VaultV2Unavailable before anything reaches IPC.
// Flip it in the same change that registers the commands in lib.rs.

export const VAULT_V2_IN_BUILD = true;

export class VaultV2Unavailable extends Error {
  constructor(op: string) {
    super(`${op}: bankon-vault/2 is not in this build (the v1 vault is in use)`);
    this.name = 'VaultV2Unavailable';
  }
}

export interface VaultCustodian {
  kind: string;
  label: string;
}

export interface VaultV2Status {
  format: 'bankon-vault/2' | 'bankon-vault/1' | null;
  exists: boolean;
  needsMigration: boolean;
  /** A migrated vault whose old v1 files are still on disk (remove with vaultRemoveV1Files). */
  v1FilesPresent?: boolean;
  unlocked: boolean;
  entryCount: number;
  custodians: VaultCustodian[];
  /** null while locked: the v2 roster is encrypted */
  accounts: { address: string; chain: string; label: string }[] | null;
  /** false when the value was derived from the v1 vault because v2 is not in this build */
  v2Available: boolean;
}

export interface MigrationPlan {
  needed: boolean;
  reason?: string;
  accounts?: number;
  chains?: string[];
  from?: string;
  to?: string;
}

export interface KdfCost {
  m_cost_kib: number;
  t_cost: number;
  p_cost: number;
}

export interface KdfProfile {
  default: KdfCost;
  floor: KdfCost;
  algorithm: 'argon2id';
}

export interface AutoLockStatus {
  seconds: number;
  enabled: boolean;
  remaining: number | null;
  unlocked: boolean;
  justLocked: boolean;
}

/** Vault format, lock state and (while unlocked) roster. */
export async function vaultV2Status(): Promise<VaultV2Status> {
  if (VAULT_V2_IN_BUILD) {
    return { ...(await invoke<Omit<VaultV2Status, 'v2Available'>>('vault_v2_status')), v2Available: true };
  }
  const v1 = await vaultStatus();
  return {
    format: v1.exists ? 'bankon-vault/1' : null,
    exists: v1.exists,
    needsMigration: false,
    unlocked: v1.unlocked,
    entryCount: v1.accounts.length,
    custodians: [],
    accounts: v1.accounts,
    v2Available: false,
  };
}

export async function vaultMigrationPlan(): Promise<MigrationPlan> {
  if (!VAULT_V2_IN_BUILD) return { needed: false, reason: 'bankon-vault/2 is not in this build' };
  return await invoke<MigrationPlan>('vault_migration_plan');
}

export async function vaultMigrate(
  passphrase: string,
): Promise<{ ok: boolean; migrated: number; format: string; note: string }> {
  if (!VAULT_V2_IN_BUILD) throw new VaultV2Unavailable('vaultMigrate');
  return await invoke('vault_migrate', { passphrase });
}

export async function vaultChangePassphrase(current: string, newPassphrase: string): Promise<void> {
  if (!VAULT_V2_IN_BUILD) throw new VaultV2Unavailable('vaultChangePassphrase');
  await invoke('vault_change_passphrase', { current, newPassphrase });
}

/**
 * Remove the bankon-vault/1 files a migration left behind. Needs the v2 vault open and the
 * passphrase again; until then the old copy keeps v1's weaker protection on disk.
 */
export async function vaultRemoveV1Files(passphrase: string): Promise<{ ok: boolean; removed: boolean }> {
  if (!VAULT_V2_IN_BUILD) throw new VaultV2Unavailable('vaultRemoveV1Files');
  return await invoke('vault_remove_v1_files', { passphrase });
}

/** Remove a custodian. The current passphrase is checked again (attempt-limited). */
export async function vaultRemoveCustodian(kind: string, label: string, passphrase: string): Promise<void> {
  if (!VAULT_V2_IN_BUILD) throw new VaultV2Unavailable('vaultRemoveCustodian');
  await invoke('vault_remove_custodian', { kind, label, passphrase });
}

/**
 * Add a wallet-signature custodian. The Keycore checks the current passphrase and that
 * `signatureB64` is `address`'s signature over this vault's binding message.
 */
export async function vaultAddSignatureCustodian(args: {
  chain: 'algorand' | 'solana' | 'ethereum';
  address: string;
  label: string;
  signatureB64: string;
  passphrase: string;
}): Promise<void> {
  if (!VAULT_V2_IN_BUILD) throw new VaultV2Unavailable('vaultAddSignatureCustodian');
  await invoke('vault_add_signature_custodian', {
    chain: args.chain, address: args.address, label: args.label,
    signatureB64: args.signatureB64, passphrase: args.passphrase,
  });
}

/** The message `address`'s wallet signs to become a custodian of this vault (names the vault). */
export async function vaultBindingMessage(address: string): Promise<{ message: string }> {
  if (!VAULT_V2_IN_BUILD) throw new VaultV2Unavailable('vaultBindingMessage');
  return await invoke<{ message: string }>('vault_binding_message', { address });
}

/** Argon2id cost profile, or null when bankon-vault/2 is not in this build. */
export async function vaultKdfProfile(): Promise<KdfProfile | null> {
  if (!VAULT_V2_IN_BUILD) return null;
  return await invoke<KdfProfile>('vault_kdf_profile');
}

/** Idle auto-lock, or null when bankon-vault/2 is not in this build. */
export async function vaultAutoLockStatus(): Promise<AutoLockStatus | null> {
  if (!VAULT_V2_IN_BUILD) return null;
  return await invoke<AutoLockStatus>('vault_auto_lock_status');
}

export async function vaultSetAutoLock(seconds: number): Promise<void> {
  if (!VAULT_V2_IN_BUILD) throw new VaultV2Unavailable('vaultSetAutoLock');
  await invoke('vault_set_auto_lock', { seconds });
}

/**
 * Check if running inside Tauri (desktop) or browser (web).
 * When in browser, fall back to localStorage crypto.
 */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}
