//! Tauri IPC commands. The frontend receives addresses and metadata only;
//! all secret material stays inside this module.

use serde::Deserialize;

use super::address::format_address;
use super::keys::{account_path, derive_xpriv, generate_mnemonic, validate_mnemonic, MnemonicWords};
use super::sign::sign_psbt_base64;
use super::{AddressKind, BtcAddressInfo, BtcNetwork};
use crate::bankon_vault::{store::VaultStore, VaultState};

/// The "primary" account address used as the vault key for a BTC mnemonic.
/// Native segwit, mainnet, account 0, index 0 — BIP-84 m/84'/0'/0'/0/0.
fn primary_address(mnemonic: &str, passphrase: &str) -> Result<String, String> {
    let path = account_path(AddressKind::NativeSegwit.purpose(), BtcNetwork::Mainnet.coin_type(), 0, 0);
    let xpriv = derive_xpriv(mnemonic, passphrase, BtcNetwork::Mainnet, &path)?;
    format_address(&xpriv, BtcNetwork::Mainnet, AddressKind::NativeSegwit)
}

#[derive(Debug, Deserialize)]
pub struct DeriveArgs {
    pub mnemonic: String,
    #[serde(default)]
    pub passphrase: String,
    pub network: BtcNetwork,
    pub kind: AddressKind,
    #[serde(default)]
    pub account: u32,
    #[serde(default)]
    pub index: u32,
}

#[tauri::command]
pub fn chain_btc_validate_mnemonic(phrase: String) -> bool {
    validate_mnemonic(&phrase)
}

#[tauri::command]
pub fn chain_btc_derive_address(args: DeriveArgs) -> Result<BtcAddressInfo, String> {
    let path = account_path(args.kind.purpose(), args.network.coin_type(), args.account, args.index);
    let xpriv = derive_xpriv(&args.mnemonic, &args.passphrase, args.network, &path)?;
    let address = format_address(&xpriv, args.network, args.kind)?;
    // xpriv drops here; secret material never crosses the boundary.
    Ok(BtcAddressInfo {
        address,
        path,
        network: args.network,
        kind: args.kind,
    })
}

// ── Vault-aware commands ────────────────────────────────────────────────
// These replace the param-passing pattern above for real use: the mnemonic
// lives encrypted in bankon_vault and is only decrypted inside Rust for the
// duration of a single derivation or signing call.

#[derive(Debug, Deserialize)]
pub struct ImportArgs {
    pub mnemonic: String,
    #[serde(default)]
    pub passphrase: String,
    #[serde(default = "default_label")]
    pub label: String,
}

fn default_label() -> String {
    "Bitcoin".to_string()
}

/// Import an existing mnemonic: validate, compute primary address, persist
/// encrypted into bankon_vault. Returns the primary address so the frontend
/// can reference this account later.
#[tauri::command]
pub fn chain_btc_import_account(
    state: tauri::State<'_, VaultState>,
    args: ImportArgs,
) -> Result<BtcAddressInfo, String> {
    if !validate_mnemonic(&args.mnemonic) {
        return Err("invalid BIP-39 mnemonic".to_string());
    }

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;

    let address = primary_address(&args.mnemonic, &args.passphrase)?;
    guard.store_by_address("bitcoin", &address, &args.label, args.mnemonic.as_bytes())?;

    Ok(BtcAddressInfo {
        address,
        path: account_path(84, 0, 0, 0),
        network: BtcNetwork::Mainnet,
        kind: AddressKind::NativeSegwit,
    })
}

/// Generate a fresh 24-word mnemonic, derive its primary address, persist
/// it in bankon_vault, and hand back BOTH the address AND the mnemonic so
/// the user can write it down. The caller MUST clear the returned mnemonic
/// from memory after the backup screen closes.
#[derive(Debug, serde::Serialize)]
pub struct NewAccountInfo {
    #[serde(flatten)]
    pub address: BtcAddressInfo,
}

#[tauri::command]
pub fn chain_btc_create_account(
    state: tauri::State<'_, VaultState>,
    label: Option<String>,
) -> Result<NewAccountInfo, String> {
    let mnemonic = generate_mnemonic(MnemonicWords::TwentyFour)?;
    let address = primary_address(&mnemonic, "")?;

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;

    guard.store_new(
        &address,
        "bitcoin",
        label.as_deref().unwrap_or("Bitcoin"),
        mnemonic.as_bytes(),
    )?;

    Ok(NewAccountInfo {
        address: BtcAddressInfo {
            address,
            path: account_path(84, 0, 0, 0),
            network: BtcNetwork::Mainnet,
            kind: AddressKind::NativeSegwit,
        },
    })
}

#[derive(Debug, Deserialize)]
pub struct VaultDeriveArgs {
    /// The primary mainnet native-segwit address that identifies this account in the vault.
    pub primary_address: String,
    pub network: BtcNetwork,
    pub kind: AddressKind,
    #[serde(default)]
    pub account: u32,
    #[serde(default)]
    pub index: u32,
    #[serde(default)]
    pub passphrase: String,
}

/// Derive a sub-address for an account already stored in the vault. The
/// mnemonic is decrypted, used for derivation, and its buffer is zeroed
/// before the command returns. Only the public address info crosses the
/// IPC boundary.
#[tauri::command]
pub fn chain_btc_derive_from_vault(
    state: tauri::State<'_, VaultState>,
    args: VaultDeriveArgs,
) -> Result<BtcAddressInfo, String> {
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;

    // Through the session seam: bankon-vault/1 or /2.
    let mut secret = guard.retrieve_by_address(&args.primary_address)?.as_slice().to_vec();
    let result = (|| -> Result<BtcAddressInfo, String> {
        let mnemonic = std::str::from_utf8(&secret)
            .map_err(|_| "stored mnemonic is not valid utf-8")?;
        let path = account_path(args.kind.purpose(), args.network.coin_type(), args.account, args.index);
        let xpriv = derive_xpriv(mnemonic, &args.passphrase, args.network, &path)?;
        let address = format_address(&xpriv, args.network, args.kind)?;
        Ok(BtcAddressInfo {
            address,
            path,
            network: args.network,
            kind: args.kind,
        })
    })();
    // Zero the decrypted mnemonic bytes regardless of outcome.
    crate::bankon_vault::secure_mem::wipe(&mut secret); // volatile: a plain loop is a dead store
    result
}

#[derive(Debug, Deserialize)]
pub struct SignPsbtArgs {
    pub primary_address: String,
    pub network: BtcNetwork,
    pub psbt_base64: String,
    #[serde(default)]
    pub passphrase: String,
}

#[derive(Debug, serde::Serialize)]
pub struct SignedPsbt {
    pub psbt_base64: String,
}

/// Sign a PSBT using the mnemonic stored in bankon_vault for the given
/// primary address. The mnemonic is decrypted, the signer runs, and the
/// decrypted buffer is zeroed before the signed PSBT goes back across IPC.
#[tauri::command]
pub async fn chain_btc_sign_psbt(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    approvals: tauri::State<'_, crate::bankon_vault::approval::ApprovalState>,
    args: SignPsbtArgs,
) -> Result<SignedPsbt, String> {
    {
        use crate::bankon_vault::approval::{self, Request};
        let facts = approval::psbt_facts(&args.psbt_base64, "BTC", |s| bitcoin::Address::from_script(s, args.network.as_bitcoin()).ok().map(|a| a.to_string()));
        approval::authorize(&app, &approvals, None, &args.primary_address, args.psbt_base64.as_bytes(), |d| {
            let mut r = Request::new("sign a BTC transaction", "bitcoin", &args.primary_address, std::slice::from_ref(d));
            r.facts = facts;
            r
        })
        .await?;
    }
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;

    // Through the session seam: bankon-vault/1 or /2.
    let mut secret = guard.retrieve_by_address(&args.primary_address)?.as_slice().to_vec();
    let result = (|| -> Result<SignedPsbt, String> {
        let mnemonic = std::str::from_utf8(&secret)
            .map_err(|_| "stored mnemonic is not valid utf-8")?;
        let signed = sign_psbt_base64(mnemonic, &args.passphrase, args.network, &args.psbt_base64)?;
        Ok(SignedPsbt { psbt_base64: signed })
    })();
    crate::bankon_vault::secure_mem::wipe(&mut secret); // volatile: a plain loop is a dead store
    result
}
