// bankon_vault — Modular encrypted key vault
// Portable across wallet implementations. Secrets stay in Rust.
//
// Storage: Argon2id KDF → AES-256-GCM encrypted files
// Location: Tauri app_data_dir / bankon_vault /   (the `default` profile)
//           Tauri app_data_dir / vaults / <name> /  (every other profile)
// Interface: create, unlock, lock, store, retrieve, remove, list

pub mod approval;
pub mod binding;
pub mod crypto;
// bankon-vault/2: compiled and tested since 0.2.2, wired into the session in 0.2.6.
#[allow(dead_code)]
pub mod format;
pub mod kdf;
pub mod msgpack;
// bankon-vault/2: compiled and tested since 0.2.2, wired into the session in 0.2.6.
#[allow(dead_code)]
pub mod overseer;
pub mod secure_mem;
pub mod store;
pub mod commands;
pub mod profiles;
pub mod tomb;
pub mod tomb_commands;
pub mod throttle;
// bankon-vault/2: compiled and tested since 0.2.2, wired into the session in 0.2.6.
#[allow(dead_code)]
pub mod vault;

use std::sync::Mutex;

/// How long a newly created account can be revealed without the passphrase.
const FRESH_FOR: std::time::Duration = std::time::Duration::from_secs(600);
/// Vault session state — managed by Tauri
pub struct VaultState {
    pub inner: Mutex<VaultSession>,
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(VaultSession::default()),
        }
    }
}

/// Runtime session — tracks unlock state
pub struct VaultSession {
    /// Derived key held in memory while unlocked: mlocked, excluded from core dumps,
    /// wiped with volatile writes when it is dropped (`SecretBytes`).
    session_key: Option<secure_mem::SecretBytes>,
    /// Path to vault directory
    vault_dir: Option<std::path::PathBuf>,
    /// Accounts the Keycore created this session, not yet revealed for backup.
    fresh: std::collections::HashMap<String, std::time::Instant>,
}

impl Default for VaultSession {
    fn default() -> Self {
        Self {
            session_key: None,
            vault_dir: None,
            fresh: std::collections::HashMap::new(),
        }
    }
}

impl VaultSession {
    pub fn is_unlocked(&self) -> bool {
        self.session_key.is_some()
    }

    /// Lock: drop the key (SecretBytes wipes it) AND forget the directory, so nothing that
    /// checks only `dir()` can act on a vault after it is locked.
    pub fn lock(&mut self) {
        self.session_key = None;
        self.vault_dir = None;
        self.fresh.clear();
    }

    /// Take the derived key into protected memory; the caller's copy is wiped.
    pub fn unlock(&mut self, mut key: Vec<u8>, vault_dir: std::path::PathBuf) {
        self.session_key = Some(secure_mem::SecretBytes::from_slice(&key));
        secure_mem::wipe(&mut key);
        self.vault_dir = Some(vault_dir);
    }

    pub fn key(&self) -> Option<&[u8]> {
        self.session_key.as_ref().map(|k| k.as_slice())
    }

    pub fn dir(&self) -> Option<&std::path::Path> {
        self.vault_dir.as_deref()
    }

    /// The unlocked session's key and directory, or a refusal naming which is missing.
    ///
    /// Every chain pack needs the same pair, and each deriving it by hand is how one of
    /// them ends up reading `key()` without checking `dir()`.
    fn unlocked(&self) -> Result<(&std::path::Path, &[u8]), String> {
        match (self.vault_dir.as_deref(), self.key()) {
            (Some(dir), Some(key)) => Ok((dir, key)),
            _ => Err("vault is locked".to_string()),
        }
    }

    /// Store a chain secret under its own address.
    ///
    /// The seam every chain pack stores through, so none of them handles the session key
    /// or the vault path itself. Thin by design: the encryption, the manifest and the
    /// on-disk format are `store`'s, unchanged.
    pub fn store_by_address(
        &self,
        chain: &str,
        address: &str,
        label: &str,
        secret: &[u8],
    ) -> Result<(), String> {
        let (dir, key) = self.unlocked()?;
        store::VaultStore::store_secret(dir, key, address, chain, label, secret)
    }

    /// Store a key the Keycore just generated, and remember it as revealable once for its
    /// backup (`vault_reveal_new`) — for ten minutes, until it is revealed, or until lock.
    pub fn store_new(&mut self, chain: &str, address: &str, label: &str, secret: &[u8]) -> Result<(), String> {
        self.store_by_address(chain, address, label, secret)?;
        self.fresh.insert(address.to_string(), std::time::Instant::now());
        Ok(())
    }

    /// True once for an address `store_new` stored in the last ten minutes of this session.
    pub fn take_fresh(&mut self, address: &str) -> bool {
        matches!(self.fresh.remove(address), Some(at) if at.elapsed() < FRESH_FOR)
    }

    /// Retrieve a chain secret by address.
    ///
    /// Returns [`secure_mem::SecretBytes`] rather than a `Vec<u8>` so the plaintext is
    /// wiped when the caller drops it. A `Vec` would leave it in the allocator for
    /// whatever reads that page next.
    pub fn retrieve_by_address(&self, address: &str) -> Result<secure_mem::SecretBytes, String> {
        let (dir, key) = self.unlocked()?;
        let mut plain = store::VaultStore::retrieve_secret(dir, key, address)?;
        let out = secure_mem::SecretBytes::from_slice(&plain);
        secure_mem::wipe(&mut plain);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn a_fresh_account_is_revealable_once_and_lock_forgets_it() {
        let mut s = VaultSession::default();
        s.fresh.insert("NEW".into(), std::time::Instant::now());
        assert!(!s.take_fresh("OTHER"));
        assert!(s.take_fresh("NEW"));
        assert!(!s.take_fresh("NEW"), "once");
        s.fresh.insert("NEW2".into(), std::time::Instant::now());
        s.lock();
        assert!(!s.take_fresh("NEW2"), "lock forgets");
        s.fresh.insert("OLD".into(), std::time::Instant::now() - FRESH_FOR - std::time::Duration::from_secs(1));
        assert!(!s.take_fresh("OLD"), "expired");
    }
    use super::*;

    #[test]
    fn lock_forgets_the_key_and_the_directory() {
        let mut s = VaultSession::default();
        s.unlock(vec![7u8; 32], std::path::PathBuf::from("/tmp/vault"));
        assert!(s.is_unlocked());
        assert_eq!(s.key().unwrap(), &[7u8; 32][..]);
        assert!(s.dir().is_some());
        s.lock();
        assert!(!s.is_unlocked());
        assert!(s.key().is_none());
        assert!(s.dir().is_none(), "nothing may act on a vault directory after lock");
    }
}
