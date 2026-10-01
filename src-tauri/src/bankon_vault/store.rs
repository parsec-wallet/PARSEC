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
        Self::write_atomic(&vault_dir.join(MANIFEST_FILE), &manifest_json)
            .map_err(|e| format!("failed to write manifest: {e}"))?;

        // Write verification token — used to check passphrase without storing it
        let verify_data = crypto::encrypt(b"bankon_vault_ok", passphrase)?;
        Self::write_atomic(&vault_dir.join(VERIFY_FILE), &verify_data)
            .map_err(|e| format!("failed to write verify token: {e}"))?;

        Ok(())
    }

    /// Check if a vault exists at the given path
    pub fn exists(vault_dir: &Path) -> bool {
        vault_dir.join(MANIFEST_FILE).exists() && vault_dir.join(VERIFY_FILE).exists()
    }

    /// Whether anything of a vault is at this path: the manifest, the verify token, or any
    /// key file. `create` refuses over any of them — a vault missing one file is damaged,
    /// not absent, and writing a fresh salt over it would orphan every key it holds.
    pub fn has_any_artefact(vault_dir: &Path) -> bool {
        vault_dir.join(MANIFEST_FILE).exists()
            || vault_dir.join(VERIFY_FILE).exists()
            || fs::read_dir(vault_dir.join(KEYS_DIR))
                .map(|mut it| it.next().is_some())
                .unwrap_or(false)
    }

    /// Write a vault file so it is either the old bytes or the new ones, never a torn mix:
    /// a temp file in the same directory, owner-only (0600 on Unix), synced, then renamed
    /// over the target, then the directory synced so the rename itself is durable.
    pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let dir = path.parent().ok_or("vault path has no parent directory")?;
        let name = path.file_name().and_then(|n| n.to_str()).ok_or("vault path has no file name")?;
        let tmp = dir.join(format!(".{name}.tmp-{}", std::process::id()));
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let result = (|| {
            let mut f = opts.open(&tmp).map_err(|e| format!("failed to write {name}: {e}"))?;
            f.write_all(data).map_err(|e| format!("failed to write {name}: {e}"))?;
            f.sync_all().map_err(|e| format!("failed to sync {name}: {e}"))?;
            fs::rename(&tmp, path).map_err(|e| format!("failed to replace {name}: {e}"))?;
            if let Ok(d) = fs::File::open(dir) {
                let _ = d.sync_all(); // directory fsync: not available everywhere, best effort
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result
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
        Self::write_atomic(&path, &data)
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
        Self::write_atomic(&key_path, &encrypted)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bankon-store-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn atomic_write_replaces_whole_and_leaves_no_temp() {
        let d = scratch("atomic");
        let p = d.join("vault.json");
        VaultStore::write_atomic(&p, b"first").unwrap();
        VaultStore::write_atomic(&p, b"second, longer").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"second, longer");
        let leftovers: Vec<_> = fs::read_dir(&d).unwrap().filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-")).collect();
        assert!(leftovers.is_empty());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_damaged_vault_still_counts_as_a_vault() {
        let d = scratch("artefact");
        assert!(!VaultStore::has_any_artefact(&d));
        VaultStore::create(&d, b"correct horse battery").unwrap();
        assert!(VaultStore::exists(&d) && VaultStore::has_any_artefact(&d));
        // Losing the manifest makes `exists` false — but the vault is damaged, not absent.
        fs::remove_file(d.join(MANIFEST_FILE)).unwrap();
        assert!(!VaultStore::exists(&d));
        assert!(VaultStore::has_any_artefact(&d), "create must not be allowed over a damaged vault");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_vault_round_trips_and_rejects_a_wrong_passphrase() {
        let d = scratch("roundtrip");
        VaultStore::create(&d, b"correct horse battery").unwrap();
        assert!(VaultStore::verify_passphrase(&d, b"correct horse battery").unwrap());
        assert!(!VaultStore::verify_passphrase(&d, b"wrong").unwrap());
        let key = VaultStore::derive_session_key(&d, b"correct horse battery").unwrap();
        VaultStore::store_secret(&d, &key, "ADDR", "algorand", "a", b"secret words").unwrap();
        assert_eq!(VaultStore::retrieve_secret(&d, &key, "ADDR").unwrap(), b"secret words");
        let _ = fs::remove_dir_all(&d);
    }
}
