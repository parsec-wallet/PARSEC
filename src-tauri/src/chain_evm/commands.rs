//! Tauri commands for chain_evm: sign an EIP-1559 tx with a vault-held key, preview an address.

use super::eip712::{sign_transfer, Eip712Domain, TransferAuthorization};
use super::sign::{address_from_secret, sign_eip1559};
use super::{EvmTxRequest, SignedEvmTx};
use crate::bankon_vault::approval::{self, ApprovalState, Request};

/// A decimal base-unit amount with `decimals` places, exactly (no float).
fn units(raw: &str, decimals: usize) -> String {
    let digits = raw.trim().trim_start_matches('0');
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return if digits.is_empty() { "0".to_string() } else { format!("{raw} (unreadable)") };
    }
    let padded = format!("{digits:0>width$}", width = decimals + 1);
    let (int, frac) = padded.split_at(padded.len() - decimals);
    let frac = frac.trim_end_matches('0');
    if frac.is_empty() { int.to_string() } else { format!("{int}.{frac}") }
}

fn network(chain_id: u64) -> String {
    let name = match chain_id {
        1 => "Ethereum",
        8453 => "Base",
        84532 => "Base Sepolia",
        10 => "Optimism",
        42161 => "Arbitrum One",
        137 => "Polygon",
        11155111 => "Sepolia",
        _ => "chain",
    };
    format!("{name} (chain id {chain_id})")
}

/// What the Keycore reads from an EIP-1559 request.
fn tx_facts(tx: &EvmTxRequest) -> Vec<String> {
    let mut f = Vec::new();
    let data_len = tx.data.trim().trim_start_matches("0x").len() / 2;
    if tx.to.trim().is_empty() {
        f.push("WARNING: creates a contract".to_string());
    } else {
        f.push(format!("Send {} ETH-units to {}", units(&tx.value, 18), tx.to.trim()));
    }
    if data_len > 0 {
        f.push(format!("With {data_len} bytes of call data (a contract call; its effect is not decoded)"));
    }
    f.push(format!("Network {}", network(tx.chain_id)));
    f.push(format!("Gas limit {}, max fee {} gwei", tx.gas_limit, units(&tx.max_fee_per_gas, 9)));
    f.push(format!("Nonce {}", tx.nonce));
    f
}

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
    app: tauri::AppHandle,
    approvals: tauri::State<'_, ApprovalState>,
    vault_state: tauri::State<'_, crate::bankon_vault::VaultState>,
    address: String,
    tx: EvmTxRequest,
) -> Result<SignedEvmTx, String> {
    let request = serde_json::to_vec(&tx).map_err(|e| e.to_string())?;
    approval::authorize(&app, &approvals, None, &address, &request, |d| {
        let mut r = Request::new("sign an EVM transaction", "evm", &address, std::slice::from_ref(d));
        r.facts = tx_facts(&tx);
        r
    })
    .await?;
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

/// Create an EVM account inside the Keycore: a secp256k1 key from the OS CSPRNG, stored
/// in the vault as 0x-hex under its EIP-55 address. Only the address returns.
#[tauri::command]
pub fn chain_evm_create_account(
    vault_state: tauri::State<'_, crate::bankon_vault::VaultState>,
    label: Option<String>,
) -> Result<serde_json::Value, String> {
    use rand::RngCore;
    let mut key = [0u8; 32];
    // A uniformly random 32 bytes is a valid secp256k1 key except with negligible
    // probability; address_from_secret refuses the invalid ones, so retry.
    let address = loop {
        rand::rngs::OsRng.fill_bytes(&mut key);
        if let Ok(a) = address_from_secret(&key) {
            break a;
        }
    };
    let mut hex_key = format!("0x{}", hex::encode(key));
    wipe(&mut key);
    let stored = vault_state
        .inner
        .lock()
        .map_err(|_| "vault state poisoned".to_string())
        .and_then(|mut g| g.store_new("ethereum", &address, label.as_deref().unwrap_or("Ethereum"), hex_key.as_bytes()));
    // SAFETY: overwriting a String's bytes in place with zero bytes of equal length.
    unsafe { crate::bankon_vault::secure_mem::wipe(hex_key.as_bytes_mut()) };
    stored?;
    Ok(serde_json::json!({ "address": address }))
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
    app: tauri::AppHandle,
    approvals: tauri::State<'_, ApprovalState>,
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

    let request = serde_json::to_vec(&(&domain, &authorization)).map_err(|e| e.to_string())?;
    approval::authorize(&app, &approvals, None, &address, &request, |d| {
        let mut r = Request::new("authorize a token transfer", "evm", &address, std::slice::from_ref(d));
        r.facts = vec![
            format!(
                "Transfer {} base units of {} to {}",
                authorization.value.trim(), domain.name, authorization.to.trim()
            ),
            format!("Token contract {}", domain.verifying_contract.trim()),
            format!("Network {}", network(domain.chain_id)),
            format!("Valid until unix time {}", authorization.valid_before.trim()),
            "A facilitator may broadcast it; it cannot change the amount or the recipient".to_string(),
        ];
        r
    })
    .await?;
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
