// PARSEC Wallet — Unified Keystore
// Tauri desktop: uses bankon_vault (Rust-side Argon2id + AES-256-GCM, file-based)
// Web fallback: uses crypto.ts (Web Crypto API, localStorage)
//
// The frontend never decides which backend to use at the call site.
// This module picks the right one automatically.

import { assertAllowed } from './mode';
import { isTauri, vaultCreate, vaultUnlock, vaultLock, vaultStatus, vaultStoreKey, vaultRemoveAccount, vaultDestroy } from './vault';
import { isSessionMarker } from './session-marker';
import * as webCrypto from './crypto';
import { webKeysKey } from './profiles';

export interface KeystoreStatus {
  exists: boolean;
  unlocked: boolean;
  accounts: { address: string; chain: string; label: string }[];
  /** The profile whose vault this describes (desktop builds with profiles). */
  profile?: string;
}

/** Initialize keystore — create vault if it doesn't exist */
export async function keystoreCreate(passphrase: string): Promise<void> {
  if (isTauri()) {
    await vaultCreate(passphrase);
  }
  // Web mode: vault is created implicitly on first key save
}

/** Unlock keystore */
export async function keystoreUnlock(passphrase: string): Promise<boolean> {
  if (isTauri()) {
    // A session marker is not a passphrase; sending it would count as a failed attempt.
    if (isSessionMarker(passphrase)) return false;
    try {
      await vaultUnlock(passphrase);
      return true;
    } catch {
      return false;
    }
  } else {
    return webCrypto.verifyPassphrase(passphrase);
  }
}

/** Lock keystore */
export async function keystoreLock(): Promise<void> {
  if (isTauri()) {
    await vaultLock();
  }
  // Web mode: no session to clear
}

/** Check keystore status */
export async function keystoreStatus(): Promise<KeystoreStatus> {
  if (isTauri()) {
    return vaultStatus();
  } else {
    const has = webCrypto.hasVault();
    return { exists: has, unlocked: has, accounts: [] };
  }
}

/** Store a secret for an account */
export async function keystoreStore(
  address: string,
  secret: string,
  passphrase: string,
  label: string = 'Account',
  chain: string = 'algorand',
): Promise<void> {
  if (isTauri()) {
    // Ensure vault is unlocked
    const status = await vaultStatus();
    if (!status.unlocked) {
      if (isSessionMarker(passphrase)) throw new Error('The vault is locked. Unlock PARSEC again.');
      await vaultUnlock(passphrase);
    }
    await vaultStoreKey(address, chain, label, secret);
  } else {
    // The browser build has no IPC, so the mode guard is applied here.
    assertAllowed('keystore_store');
    await webCrypto.saveMnemonic(address, secret, passphrase);
  }
}

/**
 * Browser build only: read a secret for the moment of signing, then discard it.
 *
 * The desktop never reads a secret into JavaScript: signing goes through the PARSEC
 * Keycore (`chain_*_sign*`), and an export through `vaultExportSecret`, which asks for
 * the passphrase again.
 */
export async function keystoreRetrieve(
  address: string,
  passphrase: string,
): Promise<string | null> {
  if (isTauri()) {
    throw new Error('Secrets are not read into the app on the desktop; the PARSEC Keycore signs.');
  }
  // The browser build has no IPC, so the mode guard is applied here.
  assertAllowed('keystore_retrieve');
  return webCrypto.loadMnemonic(address, passphrase);
}

/** Remove an account */
export async function keystoreRemove(address: string): Promise<void> {
  if (isTauri()) {
    await vaultRemoveAccount(address);
  } else {
    // The browser build has no IPC, so the mode guard is applied here.
    assertAllowed('keystore_remove');
    webCrypto.removeAccount(address);
  }
}

/** Destroy everything */
export async function keystoreDestroy(passphrase: string): Promise<void> {
  if (isTauri()) {
    await vaultDestroy(passphrase);
  } else {
    // The browser build has no IPC, so the mode guard is applied here.
    assertAllowed('keystore_destroy');
    localStorage.removeItem(webKeysKey());
  }
}
