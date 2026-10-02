// chain_ar::commands — Arweave IPC.
//
// The JWK is stored in the vault as bytes tagged `rsa4096`. It never crosses the
// boundary except through the explicit export command.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Deserialize;

use super::{jwk, keys, sign, ArAccountInfo};
use crate::bankon_vault::secure_mem::wipe;
use crate::bankon_vault::VaultState;

const CHAIN: &str = "arweave";

/// Generate a new Arweave account and store its JWK.
///
/// Takes several seconds: RSA-4096 prime search is genuinely slow. The key comes
/// from the OS CSPRNG and is therefore **not recoverable from a mnemonic** — the
/// JWK is the backup. See the module docs for why the deterministic
/// mnemonic-derived path deliberately stays in TypeScript.
#[tauri::command]
pub fn chain_ar_create_account(
    state: tauri::State<'_, VaultState>,
    label: Option<String>,
) -> Result<ArAccountInfo, String> {
    let key = keys::generate()?;
    let j = keys::jwk_from_key(&key)?;
    let address = keys::address_from_jwk(&j)?;
    let owner = j.n.clone();
    let mut json = keys::jwk_to_json(&j)?;

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let stored = guard.store_by_address(
        CHAIN,
        &address,
        label.as_deref().unwrap_or("Arweave"),
        json.as_bytes(),
    );
    // SAFETY: overwriting the String's own bytes in place; the JWK is ASCII JSON.
    unsafe { wipe(json.as_bytes_mut()) };
    stored?;

    Ok(ArAccountInfo { address, owner, bits: keys::KEY_BITS })
}

#[derive(Debug, Deserialize)]
pub struct ArImportArgs {
    /// The JWK as JSON.
    pub jwk: String,
    pub label: Option<String>,
}

/// Import an existing Arweave account from its JWK.
///
/// This is also the recovery path for keys derived by the legacy TypeScript
/// mnemonic route: derive there, import the JWK here, and all subsequent signing
/// happens in Rust.
#[tauri::command]
pub fn chain_ar_import_account(
    state: tauri::State<'_, VaultState>,
    args: ArImportArgs,
) -> Result<ArAccountInfo, String> {
    let j = keys::jwk_from_json(&args.jwk)?;
    // Prove the JWK is a usable key before storing it, so a malformed import
    // cannot become an account that exists but can never sign.
    jwk::to_private_key(&j)?;
    let address = keys::address_from_jwk(&j)?;

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.store_by_address(
        CHAIN,
        &address,
        args.label.as_deref().unwrap_or("Arweave"),
        args.jwk.as_bytes(),
    )?;

    Ok(ArAccountInfo { address, owner: j.n, bits: keys::KEY_BITS })
}

/// The public owner field and address for a stored account.
#[tauri::command]
pub fn chain_ar_account_info(
    state: tauri::State<'_, VaultState>,
    address: String,
) -> Result<ArAccountInfo, String> {
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let stored = guard.retrieve_by_address(&address)?;
    let text = std::str::from_utf8(stored.as_slice())
        .map_err(|_| "stored Arweave secret is not a JWK")?;
    let j = keys::jwk_from_json(text)?;
    Ok(ArAccountInfo {
        address: keys::address_from_jwk(&j)?,
        owner: j.n,
        bits: keys::KEY_BITS,
    })
}

#[derive(Debug, Deserialize)]
pub struct ArSignArgs {
    pub address: String,
    pub payload_b64: String,
}

/// Sign with RSA-PSS / SHA-256 / 32-byte salt. The signature returns; the key does not.
#[tauri::command]
pub fn chain_ar_sign(
    state: tauri::State<'_, VaultState>,
    args: ArSignArgs,
) -> Result<serde_json::Value, String> {
    let payload = B64
        .decode(args.payload_b64.as_bytes())
        .map_err(|_| "payload_b64 is not valid base64".to_string())?;

    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let stored = guard.retrieve_by_address(&args.address)?;
    let text = std::str::from_utf8(stored.as_slice())
        .map_err(|_| "stored Arweave secret is not a JWK")?;
    let parsed = keys::jwk_from_json(text)?;
    // The key must be the one for this address (see chain_algo's seed_for).
    if keys::address_from_jwk(&parsed)? != args.address {
        return Err("the key stored for this address does not match it; nothing was signed".to_string());
    }
    let key = jwk::to_private_key(&parsed)?;
    let sig = sign::sign(&key, &payload)?;

    Ok(serde_json::json!({
        "signature_b64": B64.encode(&sig),
        "scheme": "rsa-pss-sha256",
        "salt_len": 32,
    }))
}

/// Export the JWK. EXPORT PATH — the private exponent crosses the boundary here
/// and becomes an unwipeable JavaScript string. For backup only, never signing.
#[tauri::command]
pub fn chain_ar_export_jwk(
    state: tauri::State<'_, VaultState>,
    address: String,
) -> Result<serde_json::Value, String> {
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let stored = guard.retrieve_by_address(&address)?;
    let text = std::str::from_utf8(stored.as_slice())
        .map_err(|_| "stored Arweave secret is not a JWK")?;
    // Only a real Arweave key for exactly this address leaves: a mnemonic or another chain's
    // secret stored under the address is refused, not exported.
    let parsed = keys::jwk_from_json(text).map_err(|_| "the secret stored for this address is not an Arweave JWK")?;
    if keys::address_from_jwk(&parsed)? != address {
        return Err("the stored JWK belongs to a different address; nothing was exported".to_string());
    }
    Ok(serde_json::json!({ "jwk": text }))
}
