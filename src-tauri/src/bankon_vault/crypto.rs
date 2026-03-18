// bankon_vault::crypto — Argon2id KDF + AES-256-GCM
// No secrets ever leave this module unencrypted.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use rand::RngCore;

const SALT_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

/// Derive a 256-bit key from passphrase + salt using Argon2id
pub fn derive_key(passphrase: &[u8], salt: &[u8]) -> Result<Vec<u8>, String> {
    let mut key = vec![0u8; KEY_LEN];
    Argon2::default()
        .hash_password_into(passphrase, salt, &mut key)
        .map_err(|e| format!("key derivation failed: {e}"))?;
    Ok(key)
}

/// Generate a random salt
pub fn random_salt() -> Vec<u8> {
    let mut salt = vec![0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Encrypt plaintext with a derived key
/// Returns: salt(32) + nonce(12) + ciphertext
pub fn encrypt(plaintext: &[u8], passphrase: &[u8]) -> Result<Vec<u8>, String> {
    let salt = random_salt();
    let key = derive_key(passphrase, &salt)?;

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("cipher init failed: {e}"))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("encryption failed: {e}"))?;

    // Pack: salt + nonce + ciphertext
    let mut packed = Vec::with_capacity(SALT_LEN + NONCE_LEN + ciphertext.len());
    packed.extend_from_slice(&salt);
    packed.extend_from_slice(&nonce_bytes);
    packed.extend_from_slice(&ciphertext);
    Ok(packed)
}

/// Decrypt packed data (salt + nonce + ciphertext) with passphrase
pub fn decrypt(packed: &[u8], passphrase: &[u8]) -> Result<Vec<u8>, String> {
    if packed.len() < SALT_LEN + NONCE_LEN + 1 {
        return Err("data too short".to_string());
    }

    let salt = &packed[..SALT_LEN];
    let nonce_bytes = &packed[SALT_LEN..SALT_LEN + NONCE_LEN];
    let ciphertext = &packed[SALT_LEN + NONCE_LEN..];

    let key = derive_key(passphrase, salt)?;

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("cipher init failed: {e}"))?;

    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "decryption failed — wrong passphrase or corrupted data".to_string())
}

/// Encrypt with a pre-derived key (for session operations)
pub fn encrypt_with_key(plaintext: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("cipher init failed: {e}"))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("encryption failed: {e}"))?;

    let mut packed = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    packed.extend_from_slice(&nonce_bytes);
    packed.extend_from_slice(&ciphertext);
    Ok(packed)
}

/// Decrypt with a pre-derived key (for session operations)
pub fn decrypt_with_key(packed: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    if packed.len() < NONCE_LEN + 1 {
        return Err("data too short".to_string());
    }

    let nonce_bytes = &packed[..NONCE_LEN];
    let ciphertext = &packed[NONCE_LEN..];

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("cipher init failed: {e}"))?;

    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "decryption failed".to_string())
}
