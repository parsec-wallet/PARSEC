// Parsec Wallet — bankon_vault IPC client
// All vault operations go through Tauri invoke → Rust.
// Secrets never persist in JS. They pass through briefly for signing only.

import { invoke } from '@tauri-apps/api/core';

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  accounts: { address: string; chain: string; label: string }[];
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
 * Retrieve decrypted secret — hold briefly for signing, then discard.
 * Returns null if vault is locked or key not found.
 */
export async function vaultRetrieveKey(address: string): Promise<string | null> {
  try {
    const result = await invoke<{ secret: string }>('vault_retrieve_key', { address });
    return result.secret;
  } catch {
    return null;
  }
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

/**
 * Check if running inside Tauri (desktop) or browser (web).
 * When in browser, fall back to localStorage crypto.
 */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}
