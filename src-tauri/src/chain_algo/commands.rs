// chain_algo::commands — Algorand IPC.
//
// The shape that matters: creating an account does NOT return the mnemonic.
// v1's `chain_btc_create_account` handed a freshly generated secret straight
// back across the boundary, where it becomes an unwipeable JavaScript string.
// Here the seed is generated, stored, and dropped inside Rust; the participant
// sees the mnemonic only through an explicit, separately-audited reveal.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Deserialize;

use super::{keys, mnemonic, sign, AlgoAccountInfo};
use crate::bankon_vault::secure_mem::{wipe, SecretBytes};
use crate::bankon_vault::VaultState;

const CHAIN: &str = "algorand";

/// Derive the address for a mnemonic without storing anything.
///
/// For an import preview. Takes the mnemonic as a parameter, which means it does
/// cross the IPC boundary — unavoidable when the participant is typing one in.
#[tauri::command]
pub fn chain_algo_address_from_mnemonic(mnemonic_phrase: String) -> Result<String, String> {
    let mut seed = mnemonic::to_seed(&mnemonic_phrase)?;
    let address = keys::address_from_seed(&seed);
    wipe(&mut seed);
    address
}

/// Validate a 25-word Algorand mnemonic.
#[tauri::command]
pub fn chain_algo_validate_mnemonic(mnemonic_phrase: String) -> Result<bool, String> {
    Ok(mnemonic::is_valid(&mnemonic_phrase))
}

/// Create a new account: generate a seed, store it, return the public data.
///
/// The seed never leaves Rust. Call `chain_algo_reveal_mnemonic` to show the
/// participant their backup phrase.
#[tauri::command]
pub fn chain_algo_create_account(
    state: tauri::State<'_, VaultState>,
    label: Option<String>,
) -> Result<AlgoAccountInfo, String> {
    let seed = keys::generate_seed();
    let address = keys::address_from_seed(seed.as_slice())?;
    let public = keys::public_from_seed(seed.as_slice())?;

    // Store the mnemonic rather than the raw seed: it is what a participant can
    // write down, and what every other Algorand tool will accept on recovery.
    let mut phrase = mnemonic::from_seed(seed.as_slice())?;
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let stored = guard.store_by_address(
        CHAIN,
        &address,
        label.as_deref().unwrap_or("Algorand"),
        phrase.as_bytes(),
    );
    // SAFETY: overwriting a String's bytes in place with ASCII of equal length.
    unsafe { wipe(phrase.as_bytes_mut()) };
    stored?;

    Ok(AlgoAccountInfo {
        address,
        public_key_hex: hex::encode(public),
    })
}

#[derive(Debug, Deserialize)]
pub struct AlgoImportArgs {
    pub mnemonic: String,
    pub label: Option<String>,
}

/// Import an existing account from its 25-word mnemonic.
#[tauri::command]
pub fn chain_algo_import_account(
    state: tauri::State<'_, VaultState>,
    args: AlgoImportArgs,
) -> Result<AlgoAccountInfo, String> {
    let mut seed = mnemonic::to_seed(&args.mnemonic)?;
    let address = keys::address_from_seed(&seed)?;
    let public = keys::public_from_seed(&seed)?;
    wipe(&mut seed);

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.store_by_address(
        CHAIN,
        &address,
        args.label.as_deref().unwrap_or("Algorand"),
        args.mnemonic.as_bytes(),
    )?;

    Ok(AlgoAccountInfo {
        address,
        public_key_hex: hex::encode(public),
    })
}

/// Reveal the mnemonic for backup. EXPORT PATH — not part of any signing flow.
///
/// Deliberately its own command rather than a return value from account creation,
/// so that showing a secret to the participant is always an explicit act with its
/// own audit point, and never a side effect of something else.
#[tauri::command]
pub fn chain_algo_reveal_mnemonic(
    state: tauri::State<'_, VaultState>,
    address: String,
) -> Result<serde_json::Value, String> {
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let secret = guard.retrieve_by_address(&address)?;
    let phrase = std::str::from_utf8(secret.as_slice())
        .map_err(|_| "stored Algorand secret is not a mnemonic")?;
    if !mnemonic::is_valid(phrase) {
        return Err("stored secret is not a valid 25-word Algorand mnemonic".to_string());
    }
    Ok(serde_json::json!({ "mnemonic": phrase, "words": 25 }))
}

#[derive(Debug, Deserialize)]
pub struct AlgoSignArgs {
    pub address: String,
    /// Base64 of the bytes to sign.
    pub payload_b64: String,
}

fn seed_for(guard: &crate::bankon_vault::VaultSession, address: &str) -> Result<SecretBytes, String> {
    let secret = guard.retrieve_by_address(address)?;
    let phrase = std::str::from_utf8(secret.as_slice())
        .map_err(|_| "stored Algorand secret is not a mnemonic")?;
    let mut seed = mnemonic::to_seed(phrase)?;
    // The key must be the one for this address: a secret stored under the wrong address
    // would otherwise sign as someone else, silently.
    if keys::address_from_seed(&seed)? != address {
        wipe(&mut seed);
        return Err("the key stored for this address does not match it; nothing was signed".to_string());
    }
    let out = SecretBytes::from_slice(&seed);
    wipe(&mut seed);
    Ok(out)
}

/// Sign an arbitrary message, with Algorand's `MX` domain prefix.
///
/// The signature comes back; the key does not. This is the pattern the whole
/// Phase 3 work exists to establish.
#[tauri::command]
pub fn chain_algo_sign_bytes(
    state: tauri::State<'_, VaultState>,
    args: AlgoSignArgs,
) -> Result<serde_json::Value, String> {
    let payload = B64
        .decode(args.payload_b64.as_bytes())
        .map_err(|_| "payload_b64 is not valid base64".to_string())?;
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let seed = seed_for(&guard, &args.address)?;
    let sig = sign::sign_bytes(seed.as_slice(), &payload)?;
    Ok(serde_json::json!({ "signature_b64": B64.encode(&sig), "scheme": "ed25519" }))
}

/// Sign pre-built transaction bytes exactly as given, with no added prefix.
#[tauri::command]
pub fn chain_algo_sign_transaction(
    state: tauri::State<'_, VaultState>,
    args: AlgoSignArgs,
) -> Result<serde_json::Value, String> {
    let payload = B64
        .decode(args.payload_b64.as_bytes())
        .map_err(|_| "payload_b64 is not valid base64".to_string())?;
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let seed = seed_for(&guard, &args.address)?;
    let sig = sign::sign_raw(seed.as_slice(), &payload)?;
    Ok(serde_json::json!({ "signature_b64": B64.encode(&sig), "scheme": "ed25519" }))
}
