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
    let text = std::str::from_utf8(stored.as_slice())
        .map_err(|_| "stored Solana secret is not text")?;
    seed_from_stored(text, address)
}

/// Prefix of a raw key imported from Phantom / Solflare / `solana-keygen`, stored as
/// base58 of the 64-byte secret (seed ‖ public key). Mirrors `src/lib/solana/secret.ts`.
const RAW_TAG: &str = "solana-raw:";

/// The 32-byte ed25519 seed for a stored Solana secret — a BIP-39 mnemonic
/// (m/44'/501'/0'/0') or a tagged raw key — checked against `address`.
fn seed_from_stored(text: &str, address: &str) -> Result<SecretBytes, String> {
    let derived = if let Some(b58) = text.strip_prefix(RAW_TAG) {
        let mut raw = bitcoin::base58::decode(b58.trim())
            .map_err(|_| "stored Solana raw key is not base58".to_string())?;
        if raw.len() != 64 && raw.len() != 32 {
            crate::bankon_vault::secure_mem::wipe(&mut raw);
            return Err("stored Solana raw key has the wrong length".to_string());
        }
        let seed = SecretBytes::from_slice(&raw[..32]);
        let claimed_ok = raw.len() == 32
            || keys::public_from_seed(seed.as_slice()).map(|p| p[..] == raw[32..]).unwrap_or(false);
        crate::bankon_vault::secure_mem::wipe(&mut raw);
        if !claimed_ok {
            return Err("stored Solana raw key does not match its public key".to_string());
        }
        seed
    } else {
        let bip39 = seed::seed_from_mnemonic(text)?;
        seed::derive(bip39.as_slice(), &seed::SOLANA_PATH)?
    };
    // The key must be the one for this address (see chain_algo's seed_for).
    if keys::address_from_seed(derived.as_slice())? != address {
        return Err("the key stored for this address does not match it; nothing was signed".to_string());
    }
    Ok(derived)
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

#[cfg(test)]
mod tests {
    use super::*;

    const ABANDON: &str = "abandon abandon abandon abandon abandon abandon abandon \
                           abandon abandon abandon abandon about";
    const EXPECTED: &str = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";

    fn raw_for(seed: &[u8]) -> String {
        let mut full = seed.to_vec();
        full.extend_from_slice(&keys::public_from_seed(seed).unwrap());
        format!("{RAW_TAG}{}", bitcoin::base58::encode(&full))
    }

    #[test]
    fn a_stored_mnemonic_signs_as_its_address() {
        let s = seed_from_stored(ABANDON, EXPECTED).unwrap();
        assert_eq!(keys::address_from_seed(s.as_slice()).unwrap(), EXPECTED);
    }

    #[test]
    fn a_stored_raw_key_signs_as_the_same_address() {
        let from_mnemonic = seed_from_stored(ABANDON, EXPECTED).unwrap();
        let raw = raw_for(from_mnemonic.as_slice());
        let s = seed_from_stored(&raw, EXPECTED).unwrap();
        assert_eq!(s.as_slice(), from_mnemonic.as_slice());
    }

    #[test]
    fn a_raw_key_whose_public_half_is_wrong_is_refused() {
        let seed = seed_from_stored(ABANDON, EXPECTED).unwrap();
        let mut full = seed.as_slice().to_vec();
        full.extend_from_slice(&[7u8; 32]);
        let bad = format!("{RAW_TAG}{}", bitcoin::base58::encode(&full));
        assert!(seed_from_stored(&bad, EXPECTED).is_err());
    }

    #[test]
    fn a_secret_for_another_address_is_refused() {
        assert!(seed_from_stored(ABANDON, "11111111111111111111111111111111").is_err());
    }
}
