//! Tauri commands for chain_evm: sign an EIP-1559 tx with a vault-held key, preview an address.

use super::eip712::{sign_transfer, Eip712Domain, TransferAuthorization};
use super::sign::{address_from_secret, sign_eip1559};
use super::{EvmTxRequest, SignedEvmTx};

/// Decode a 0x-prefixed or raw hex private key into exactly 32 bytes.
fn key_array_from_hex(secret: &str) -> Result<[u8; 32], String> {
    let t = secret.trim();
    let t = t.strip_prefix("0x").unwrap_or(t);
    let bytes = hex::decode(t).map_err(|e| format!("invalid hex key: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!("invalid key length: {} (expected 32)", bytes.len()));
    }
    Ok(bytes.try_into().map_err(|_| "key conversion failed")?)
}

/// Overwrite key material in place.
///
/// This was the only correct wipe in the tree; it now lives in
/// `bankon_vault::secure_mem` and is shared by every module that touches key
/// material, rather than being reimplemented (weakly) per chain pack.
fn wipe(key: &mut [u8; 32]) {
    crate::bankon_vault::secure_mem::wipe(key);
}

/// Sign an EIP-1559 transaction with the EVM key stored in bankon_vault under `address`.
/// The key is retrieved, checked against `address`, used once, then zeroed.
#[tauri::command]
pub async fn chain_evm_sign_tx(
    vault_state: tauri::State<'_, crate::bankon_vault::VaultState>,
    address: String,
    tx: EvmTxRequest,
) -> Result<SignedEvmTx, String> {
    let guard = vault_state.inner.lock().map_err(|_| "vault state poisoned")?;
    // Session seam: resolves against bankon-vault/1 or /2. Reading `guard.key()`
    // directly would break signing the moment a participant migrates.
    let secret = guard.retrieve_by_address(&address)?;
    let secret_text = std::str::from_utf8(secret.as_slice())
        .map_err(|_| "stored EVM secret is not valid utf-8")?;
    let mut key_array = key_array_from_hex(secret_text)?;

    let result = address_from_secret(&key_array).and_then(|derived| {
        if derived.eq_ignore_ascii_case(address.trim()) {
            sign_eip1559(&key_array, &tx)
        } else {
            Err("vault key does not match address".to_string())
        }
    });
    wipe(&mut key_array);
    result
}

/// Pure helper for import preview: derive the 0x address from a hex private key. Stores nothing.
#[tauri::command]
pub fn chain_evm_address_from_key(private_key_hex: String) -> Result<String, String> {
    let mut key_array = key_array_from_hex(&private_key_hex)?;
    let result = address_from_secret(&key_array);
    wipe(&mut key_array);
    result
}

/// Sign an EIP-3009 `TransferWithAuthorization` with the EVM key stored under `address`.
///
/// This is the x402 `exact` scheme on EVM: the payer authorizes a transfer of a named
/// amount to a named recipient within a validity window, and a facilitator broadcasts it
/// and pays the gas. The facilitator can refuse to broadcast; it cannot change where the
/// money goes.
///
/// `authorization.from` must be the signing address. It would be useless otherwise — the
/// token contract recovers the signer and compares — but refusing here means the
/// participant gets an error instead of a signature that silently authorizes nothing.
///
/// The signature comes back; the key does not.
#[tauri::command]
pub async fn chain_evm_sign_transfer_authorization(
    vault_state: tauri::State<'_, crate::bankon_vault::VaultState>,
    address: String,
    domain: Eip712Domain,
    authorization: TransferAuthorization,
) -> Result<serde_json::Value, String> {
    if !authorization.from.trim().eq_ignore_ascii_case(address.trim()) {
        return Err(format!(
            "authorization.from ({}) is not the signing address ({address})",
            authorization.from
        ));
    }

    let guard = vault_state.inner.lock().map_err(|_| "vault state poisoned")?;
    let secret = guard.retrieve_by_address(&address)?;
    let secret_text = std::str::from_utf8(secret.as_slice())
        .map_err(|_| "stored EVM secret is not valid utf-8")?;
    let mut key_array = key_array_from_hex(secret_text)?;

    let result = address_from_secret(&key_array).and_then(|derived| {
        if derived.eq_ignore_ascii_case(address.trim()) {
            sign_transfer(&key_array, &domain, &authorization)
        } else {
            Err("vault key does not match address".to_string())
        }
    });
    wipe(&mut key_array);

    let (signature, digest) = result?;
    Ok(serde_json::json!({
        "signature_hex": format!("0x{}", hex::encode(&signature)),
        "digest_hex": format!("0x{}", hex::encode(digest)),
        "scheme": "secp256k1-eip712",
    }))
}
