// bankon_vault::store — File-based encrypted vault storage
// Each account's secret is an individual encrypted file.
// Vault metadata (account list, labels) stored in a manifest.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use super::crypto;

const MANIFEST_FILE: &str = "vault.json";
const KEYS_DIR: &str = "keys";
const VERIFY_FILE: &str = ".verify";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountEntry {
    pub address: String,
    pub chain: String,
    pub label: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultManifest {
    pub version: u32,
    pub accounts: Vec<AccountEntry>,
}

impl Default for VaultManifest {
    fn default() -> Self {
        Self {
            version: 1,
            accounts: Vec::new(),
        }
    }
}

/// Filesystem operations for the vault
pub struct VaultStore;

impl VaultStore {
    /// Initialize vault directory structure and verification token
    pub fn create(vault_dir: &Path, passphrase: &[u8]) -> Result<(), String> {
        fs::create_dir_all(vault_dir.join(KEYS_DIR))
            .map_err(|e| format!("failed to create vault dir: {e}"))?;

        // Write empty manifest
        let manifest = VaultManifest::default();
        let manifest_json = serde_json::to_vec_pretty(&manifest)
            .map_err(|e| format!("manifest serialize failed: {e}"))?;
        fs::write(vault_dir.join(MANIFEST_FILE), &manifest_json)
            .map_err(|e| format!("failed to write manifest: {e}"))?;

        // Write verification token — used to check passphrase without storing it
        let verify_data = crypto::encrypt(b"bankon_vault_ok", passphrase)?;
        fs::write(vault_dir.join(VERIFY_FILE), &verify_data)
            .map_err(|e| format!("failed to write verify token: {e}"))?;

        Ok(())
    }

    /// Check if a vault exists at the given path
    pub fn exists(vault_dir: &Path) -> bool {
        vault_dir.join(MANIFEST_FILE).exists() && vault_dir.join(VERIFY_FILE).exists()
    }

    /// Verify passphrase against stored verification token
    pub fn verify_passphrase(vault_dir: &Path, passphrase: &[u8]) -> Result<bool, String> {
        let verify_path = vault_dir.join(VERIFY_FILE);
        if !verify_path.exists() {
            return Err("vault not initialized".to_string());
        }

        let data = fs::read(&verify_path)
            .map_err(|e| format!("failed to read verify token: {e}"))?;

        match crypto::decrypt(&data, passphrase) {
            Ok(plaintext) => Ok(plaintext == b"bankon_vault_ok"),
            Err(_) => Ok(false),
        }
    }

    /// Derive session key from passphrase (for subsequent operations)
    pub fn derive_session_key(vault_dir: &Path, passphrase: &[u8]) -> Result<Vec<u8>, String> {
        // Read the salt from the verify file and use it for session key
        let verify_path = vault_dir.join(VERIFY_FILE);
        let data = fs::read(&verify_path)
            .map_err(|e| format!("failed to read verify token: {e}"))?;

        // Salt is the first 32 bytes of the verify file
        if data.len() < 32 {
            return Err("corrupt verify token".to_string());
        }

        crypto::derive_key(passphrase, &data[..32])
    }

    /// Read the vault manifest
    pub fn read_manifest(vault_dir: &Path) -> Result<VaultManifest, String> {
        let path = vault_dir.join(MANIFEST_FILE);
        let data = fs::read(&path)
            .map_err(|e| format!("failed to read manifest: {e}"))?;
        serde_json::from_slice(&data)
            .map_err(|e| format!("failed to parse manifest: {e}"))
    }

    /// Write the vault manifest
    fn write_manifest(vault_dir: &Path, manifest: &VaultManifest) -> Result<(), String> {
        let path = vault_dir.join(MANIFEST_FILE);
        let data = serde_json::to_vec_pretty(manifest)
            .map_err(|e| format!("manifest serialize failed: {e}"))?;
        fs::write(&path, &data)
            .map_err(|e| format!("failed to write manifest: {e}"))
    }

    /// Store an encrypted secret for an account
    pub fn store_secret(
        vault_dir: &Path,
        session_key: &[u8],
        address: &str,
        chain: &str,
        label: &str,
        secret: &[u8],
    ) -> Result<(), String> {
        // Encrypt the secret with the session key
        let encrypted = crypto::encrypt_with_key(secret, session_key)?;

        // Write encrypted file
        let key_path = Self::key_path(vault_dir, address);
        fs::write(&key_path, &encrypted)
            .map_err(|e| format!("failed to write key file: {e}"))?;

        // Update manifest
        let mut manifest = Self::read_manifest(vault_dir)?;

        // Remove existing entry if present
        manifest.accounts.retain(|a| a.address != address);

        manifest.accounts.push(AccountEntry {
            address: address.to_string(),
            chain: chain.to_string(),
            label: label.to_string(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });

        Self::write_manifest(vault_dir, &manifest)
    }

    /// Retrieve and decrypt a secret
    pub fn retrieve_secret(
        vault_dir: &Path,
        session_key: &[u8],
        address: &str,
    ) -> Result<Vec<u8>, String> {
        let key_path = Self::key_path(vault_dir, address);
        if !key_path.exists() {
            return Err(format!("no key stored for {address}"));
        }

        let encrypted = fs::read(&key_path)
            .map_err(|e| format!("failed to read key file: {e}"))?;

        crypto::decrypt_with_key(&encrypted, session_key)
    }

    /// Remove an account and its key file
    pub fn remove_account(vault_dir: &Path, address: &str) -> Result<(), String> {
        // Remove key file
        let key_path = Self::key_path(vault_dir, address);
        if key_path.exists() {
            fs::remove_file(&key_path)
                .map_err(|e| format!("failed to remove key file: {e}"))?;
        }

        // Update manifest
        let mut manifest = Self::read_manifest(vault_dir)?;
        manifest.accounts.retain(|a| a.address != address);
        Self::write_manifest(vault_dir, &manifest)
    }

    /// Path to an individual key file (address is hex-encoded filename)
    fn key_path(vault_dir: &Path, address: &str) -> PathBuf {
        // Sanitize address for use as filename
        let safe_name: String = address
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '_' })
            .collect();
        vault_dir.join(KEYS_DIR).join(format!("{safe_name}.enc"))
    }

    /// Destroy the entire vault
    pub fn destroy(vault_dir: &Path) -> Result<(), String> {
        if vault_dir.exists() {
            fs::remove_dir_all(vault_dir)
                .map_err(|e| format!("failed to destroy vault: {e}"))?;
        }
        Ok(())
    }
}
