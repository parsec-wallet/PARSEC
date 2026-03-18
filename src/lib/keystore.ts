// Parsec Wallet — Unified Keystore
// Tauri desktop: uses bankon_vault (Rust-side Argon2id + AES-256-GCM, file-based)
// Web fallback: uses crypto.ts (Web Crypto API, localStorage)
//
// The frontend never decides which backend to use at the call site.
// This module picks the right one automatically.

import { isTauri, vaultCreate, vaultUnlock, vaultLock, vaultStatus, vaultStoreKey, vaultRetrieveKey, vaultRemoveAccount, vaultDestroy } from './vault';
import * as webCrypto from './crypto';

export interface KeystoreStatus {
  exists: boolean;
  unlocked: boolean;
  accounts: { address: string; chain: string; label: string }[];
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
      await vaultUnlock(passphrase);
    }
    await vaultStoreKey(address, chain, label, secret);
  } else {
    await webCrypto.saveMnemonic(address, secret, passphrase);
  }
}

/** Retrieve a secret — hold briefly for signing, then discard */
export async function keystoreRetrieve(
  address: string,
  passphrase: string,
): Promise<string | null> {
  if (isTauri()) {
    const status = await vaultStatus();
    if (!status.unlocked) {
      try {
        await vaultUnlock(passphrase);
      } catch {
        return null;
      }
    }
    return vaultRetrieveKey(address);
  } else {
    return webCrypto.loadMnemonic(address, passphrase);
  }
}

/** Remove an account */
export async function keystoreRemove(address: string): Promise<void> {
  if (isTauri()) {
    await vaultRemoveAccount(address);
  } else {
    webCrypto.removeAccount(address);
  }
}

/** Destroy everything */
export async function keystoreDestroy(passphrase: string): Promise<void> {
  if (isTauri()) {
    await vaultDestroy(passphrase);
  } else {
    localStorage.removeItem('parsec-encrypted-keys');
  }
}
