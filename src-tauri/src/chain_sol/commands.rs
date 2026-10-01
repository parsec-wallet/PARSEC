// chain_sol::commands — Solana IPC. Same shape as chain_algo: the key is
// generated, used and dropped in Rust; only public data and signatures return.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Deserialize;

use super::{keys, seed, sign, SolAccountInfo};
use crate::bankon_vault::secure_mem::SecretBytes;
use crate::bankon_vault::VaultState;

const CHAIN: &str = "solana";

/// Preview the address for a BIP-39 mnemonic. Stores nothing.
#[tauri::command]
pub fn chain_sol_address_from_mnemonic(mnemonic_phrase: String) -> Result<SolAccountInfo, String> {
    let bip39 = seed::seed_from_mnemonic(&mnemonic_phrase)?;
    let sk = seed::derive(bip39.as_slice(), &seed::SOLANA_PATH)?;
    Ok(SolAccountInfo {
        address: keys::address_from_seed(sk.as_slice())?,
        public_key_hex: hex::encode(keys::public_from_seed(sk.as_slice())?),
        path: seed::path_string(&seed::SOLANA_PATH),
    })
}

#[derive(Debug, Deserialize)]
pub struct SolImportArgs {
    pub mnemonic: String,
    pub label: Option<String>,
}

/// Import a Solana account from a BIP-39 mnemonic.
#[tauri::command]
pub fn chain_sol_import_account(
    state: tauri::State<'_, VaultState>,
    args: SolImportArgs,
) -> Result<SolAccountInfo, String> {
    let info = chain_sol_address_from_mnemonic(args.mnemonic.clone())?;
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.store_by_address(
        CHAIN,
        &info.address,
        args.label.as_deref().unwrap_or("Solana"),
        args.mnemonic.as_bytes(),
    )?;
    Ok(info)
}

fn secret_for(
    guard: &crate::bankon_vault::VaultSession,
    address: &str,
) -> Result<SecretBytes, String> {
    let stored = guard.retrieve_by_address(address)?;
    let phrase = std::str::from_utf8(stored.as_slice())
        .map_err(|_| "stored Solana secret is not a mnemonic")?;
    let bip39 = seed::seed_from_mnemonic(phrase)?;
    seed::derive(bip39.as_slice(), &seed::SOLANA_PATH)
}

#[derive(Debug, Deserialize)]
pub struct SolSignArgs {
    pub address: String,
    pub payload_b64: String,
}

/// Sign a Solana message. The signature returns; the key does not.
#[tauri::command]
pub fn chain_sol_sign(
    state: tauri::State<'_, VaultState>,
    args: SolSignArgs,
) -> Result<serde_json::Value, String> {
    let payload = B64
        .decode(args.payload_b64.as_bytes())
        .map_err(|_| "payload_b64 is not valid base64".to_string())?;
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let sk = secret_for(&guard, &args.address)?;
    let sig = sign::sign(sk.as_slice(), &payload)?;
    Ok(serde_json::json!({ "signature_b64": B64.encode(&sig), "scheme": "ed25519" }))
}
