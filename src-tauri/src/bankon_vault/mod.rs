// bankon_vault — Modular encrypted key vault
// Portable across wallet implementations. Secrets stay in Rust.
//
// Storage: Argon2id KDF → AES-256-GCM encrypted files
// Location: Tauri app_data_dir / bankon_vault /
// Interface: create, unlock, lock, store, retrieve, remove, list

pub mod crypto;
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
}
