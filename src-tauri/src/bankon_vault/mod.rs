// bankon_vault — Modular encrypted key vault
// Portable across wallet implementations. Secrets stay in Rust.
//
// Storage: Argon2id KDF → AES-256-GCM encrypted files
// Location: Tauri app_data_dir / bankon_vault /   (the `default` profile)
//           Tauri app_data_dir / vaults / <name> /  (every other profile)
// Interface: create, unlock, lock, store, retrieve, remove, list

pub mod approval;
pub mod binding;
pub mod binding_verify;
pub mod crypto;
pub mod format;
pub mod kdf;
pub mod msgpack;
pub mod overseer;
pub mod secure_mem;
pub mod store;
pub mod commands;
pub mod commands_v2;
pub mod profiles;
pub mod tomb;
pub mod tomb_commands;
pub mod throttle;
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

/// An open `bankon-vault/2` vault and its data key.
pub struct V2Session {
    pub vault: vault::Vault,
    pub dek: vault::Dek,
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
    /// The open `bankon-vault/2` vault, if the session is a v2 one.
    v2: Option<V2Session>,
    /// Idle auto-lock in seconds (0 = off) and the last activity.
    auto_lock_secs: u64,
    last_activity: Option<std::time::Instant>,
}

impl Default for VaultSession {
    fn default() -> Self {
        Self {
            session_key: None,
            vault_dir: None,
            fresh: std::collections::HashMap::new(),
            v2: None,
            auto_lock_secs: 0,
            last_activity: None,
        }
    }
}

impl VaultSession {
    pub fn is_unlocked(&self) -> bool {
        self.session_key.is_some() || self.v2.is_some()
    }

    pub fn v2(&self) -> Option<&V2Session> {
        self.v2.as_ref()
    }

    pub fn v2_mut(&mut self) -> Option<&mut V2Session> {
        self.v2.as_mut()
    }

    /// Open a v2 session (closing whatever was open).
    pub fn unlock_v2(&mut self, vault: vault::Vault, dek: vault::Dek, vault_dir: std::path::PathBuf) {
        self.lock();
        self.v2 = Some(V2Session { vault, dek });
        self.vault_dir = Some(vault_dir);
        self.last_activity = Some(std::time::Instant::now());
    }

    /// Lock if the idle timeout has passed. True if it locked now.
    pub fn lock_if_idle(&mut self) -> bool {
        if self.auto_lock_secs == 0 || !self.is_unlocked() {
            return false;
        }
        let idle = self.last_activity.map_or(true, |t| t.elapsed().as_secs() >= self.auto_lock_secs);
        if idle {
            self.lock();
        }
        idle
    }

    pub fn touch(&mut self) {
        self.last_activity = Some(std::time::Instant::now());
    }

    pub fn set_auto_lock_secs(&mut self, secs: u64) {
        self.auto_lock_secs = secs;
        self.touch();
    }

    pub fn auto_lock_secs(&self) -> u64 {
        self.auto_lock_secs
    }

    /// Seconds left before the idle lock, if it is on and a session is open.
    pub fn idle_remaining_secs(&self) -> Option<u64> {
        if self.auto_lock_secs == 0 || !self.is_unlocked() {
            return None;
        }
        let used = self.last_activity.map_or(self.auto_lock_secs, |t| t.elapsed().as_secs());
        Some(self.auto_lock_secs.saturating_sub(used))
    }

    /// Lock: drop the key (SecretBytes wipes it) AND forget the directory, so nothing that
    /// checks only `dir()` can act on a vault after it is locked.
    pub fn lock(&mut self) {
        self.session_key = None;
        self.vault_dir = None;
        self.fresh.clear();
        self.v2 = None;
        self.last_activity = None;
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
