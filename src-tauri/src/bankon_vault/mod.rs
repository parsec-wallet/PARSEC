// bankon_vault — Modular encrypted key vault
// Portable across wallet implementations. Secrets stay in Rust.
//
// Storage: Argon2id KDF → AES-256-GCM encrypted files
// Location: Tauri app_data_dir / bankon_vault /
// Interface: create, unlock, lock, store, retrieve, remove, list

pub mod crypto;
pub mod secure_mem;
pub mod store;
pub mod commands;
pub mod tomb;
pub mod tomb_commands;

use std::sync::Mutex;
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
    /// Derived key held in memory while unlocked
    session_key: Option<Vec<u8>>,
    /// Path to vault directory
    vault_dir: Option<std::path::PathBuf>,
}

impl Default for VaultSession {
    fn default() -> Self {
        Self {
            session_key: None,
            vault_dir: None,
        }
    }
}

impl Drop for VaultSession {
    fn drop(&mut self) {
        // Zeroize session key on drop
        if let Some(ref mut key) = self.session_key {
            key.iter_mut().for_each(|b| *b = 0);
        }
    }
}

impl VaultSession {
    pub fn is_unlocked(&self) -> bool {
        self.session_key.is_some()
    }

    pub fn lock(&mut self) {
        if let Some(ref mut key) = self.session_key {
            key.iter_mut().for_each(|b| *b = 0);
        }
        self.session_key = None;
    }

    pub fn unlock(&mut self, key: Vec<u8>, vault_dir: std::path::PathBuf) {
        self.session_key = Some(key);
        self.vault_dir = Some(vault_dir);
    }

    pub fn key(&self) -> Option<&[u8]> {
        self.session_key.as_deref()
    }

    pub fn dir(&self) -> Option<&std::path::Path> {
        self.vault_dir.as_deref()
    }

    /// The unlocked session's key and directory, or a refusal naming which is missing.
    ///
    /// Every chain pack needs the same pair, and each deriving it by hand is how one of
    /// them ends up reading `key()` without checking `dir()`.
    fn unlocked(&self) -> Result<(&std::path::Path, &[u8]), String> {
        match (self.vault_dir.as_deref(), self.session_key.as_deref()) {
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
