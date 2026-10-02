//! Tauri IPC commands for Litecoin. Mirrors chain_btc: the mnemonic lives
//! encrypted in bankon_vault and is only decrypted inside Rust for the
//! duration of a single derivation or signing call.

use serde::{Deserialize, Serialize};

use super::address::format_address;
use super::keys::{account_path, derive_xpriv};
use super::sign::sign_psbt_base64;
use super::{LtcAddressInfo, LtcAddressKind, LtcNetwork};
use crate::bankon_vault::{store::VaultStore, VaultState};

fn primary_address(mnemonic: &str, passphrase: &str) -> Result<String, String> {
    let path = account_path(
        LtcAddressKind::NativeSegwit.purpose(),
        LtcNetwork::Mainnet.coin_type(),
        0,
        0,
    );
    let xpriv = derive_xpriv(mnemonic, passphrase, &path)?;
    format_address(&xpriv, LtcNetwork::Mainnet, LtcAddressKind::NativeSegwit)
}

#[derive(Debug, Deserialize)]
pub struct DeriveArgs {
    pub mnemonic: String,
    #[serde(default)]
    pub passphrase: String,
    pub network: LtcNetwork,
    pub kind: LtcAddressKind,
    #[serde(default)]
    pub account: u32,
    #[serde(default)]
    pub index: u32,
}

/// Derive a single LTC address from a mnemonic provided in the call.
/// Intended for testing and pre-vault bootstrap; real use should go
/// through the vault-aware commands below.
#[tauri::command]
pub fn chain_ltc_derive_address(args: DeriveArgs) -> Result<LtcAddressInfo, String> {
    let path = account_path(
        args.kind.purpose(),
        args.network.coin_type(),
        args.account,
        args.index,
    );
    let xpriv = derive_xpriv(&args.mnemonic, &args.passphrase, &path)?;
    let address = format_address(&xpriv, args.network, args.kind)?;
    Ok(LtcAddressInfo {
        address,
        path,
        network: args.network,
        kind: args.kind,
    })
}

#[derive(Debug, Deserialize)]
pub struct ImportArgs {
    pub mnemonic: String,
    #[serde(default)]
    pub passphrase: String,
    #[serde(default = "default_label")]
    pub label: String,
}

fn default_label() -> String {
    "Litecoin".to_string()
}

/// Import an existing mnemonic into bankon_vault keyed by the primary
/// Litecoin native-segwit mainnet address.
#[tauri::command]
pub fn chain_ltc_import_account(
    state: tauri::State<'_, VaultState>,
    args: ImportArgs,
) -> Result<LtcAddressInfo, String> {
    // Use the BIP-39 validator from chain_btc — BIP-39 is chain-agnostic.
    if !crate::chain_btc::keys::validate_mnemonic(&args.mnemonic) {
        return Err("invalid BIP-39 mnemonic".to_string());
    }

    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let key = guard.key().ok_or("vault is locked")?;
    let dir = guard.dir().ok_or("vault is locked")?;

    let address = primary_address(&args.mnemonic, &args.passphrase)?;
    VaultStore::store_secret(dir, key, &address, "litecoin", &args.label, args.mnemonic.as_bytes())?;

    Ok(LtcAddressInfo {
        address,
        path: account_path(84, 2, 0, 0),
        network: LtcNetwork::Mainnet,
        kind: LtcAddressKind::NativeSegwit,
    })
}

#[derive(Debug, Serialize)]
pub struct NewAccountInfo {
    #[serde(flatten)]
    pub address: LtcAddressInfo,
}

#[tauri::command]
pub fn chain_ltc_create_account(
    state: tauri::State<'_, VaultState>,
    label: Option<String>,
) -> Result<NewAccountInfo, String> {
    let mnemonic = crate::chain_btc::keys::generate_mnemonic(
        crate::chain_btc::keys::MnemonicWords::TwentyFour,
    )?;
    let address = primary_address(&mnemonic, "")?;

    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let key = guard.key().ok_or("vault is locked")?;
    let dir = guard.dir().ok_or("vault is locked")?;

    VaultStore::store_secret(
        dir,
        key,
        &address,
        "litecoin",
        label.as_deref().unwrap_or("Litecoin"),
        mnemonic.as_bytes(),
    )?;

    Ok(NewAccountInfo {
        address: LtcAddressInfo {
            address,
            path: account_path(84, 2, 0, 0),
            network: LtcNetwork::Mainnet,
            kind: LtcAddressKind::NativeSegwit,
        },
    })
}

#[derive(Debug, Deserialize)]
pub struct VaultDeriveArgs {
    pub primary_address: String,
    pub network: LtcNetwork,
    pub kind: LtcAddressKind,
    #[serde(default)]
    pub account: u32,
    #[serde(default)]
    pub index: u32,
    #[serde(default)]
    pub passphrase: String,
}

#[tauri::command]
pub fn chain_ltc_derive_from_vault(
    state: tauri::State<'_, VaultState>,
    args: VaultDeriveArgs,
) -> Result<LtcAddressInfo, String> {
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let key = guard.key().ok_or("vault is locked")?;
    let dir = guard.dir().ok_or("vault is locked")?;

    let mut secret = VaultStore::retrieve_secret(dir, key, &args.primary_address)?;
    let result = (|| -> Result<LtcAddressInfo, String> {
        let mnemonic = std::str::from_utf8(&secret)
            .map_err(|_| "stored mnemonic is not valid utf-8")?;
        let path = account_path(
            args.kind.purpose(),
            args.network.coin_type(),
            args.account,
            args.index,
        );
        let xpriv = derive_xpriv(mnemonic, &args.passphrase, &path)?;
        let address = format_address(&xpriv, args.network, args.kind)?;
        Ok(LtcAddressInfo {
            address,
            path,
            network: args.network,
            kind: args.kind,
        })
    })();
    crate::bankon_vault::secure_mem::wipe(&mut secret); // volatile: a plain loop is a dead store
    result
}

#[derive(Debug, Deserialize)]
pub struct SignPsbtArgs {
    pub primary_address: String,
    pub psbt_base64: String,
    #[serde(default)]
    pub passphrase: String,
}

#[derive(Debug, Serialize)]
pub struct SignedPsbt {
    pub psbt_base64: String,
}

#[tauri::command]
pub async fn chain_ltc_sign_psbt(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    approvals: tauri::State<'_, crate::bankon_vault::approval::ApprovalState>,
    args: SignPsbtArgs,
) -> Result<SignedPsbt, String> {
    {
        use crate::bankon_vault::approval::{self, Request};
        let facts = approval::psbt_facts(&args.psbt_base64, "LTC", |_| None);
        approval::authorize(&app, &approvals, None, &args.primary_address, args.psbt_base64.as_bytes(), |d| {
            let mut r = Request::new("sign a LTC transaction", "litecoin", &args.primary_address, std::slice::from_ref(d));
            r.facts = facts;
            r
        })
        .await?;
    }
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let key = guard.key().ok_or("vault is locked")?;
    let dir = guard.dir().ok_or("vault is locked")?;

    let mut secret = VaultStore::retrieve_secret(dir, key, &args.primary_address)?;
    let result = (|| -> Result<SignedPsbt, String> {
        let mnemonic = std::str::from_utf8(&secret)
            .map_err(|_| "stored mnemonic is not valid utf-8")?;
        let signed = sign_psbt_base64(mnemonic, &args.passphrase, &args.psbt_base64)?;
        Ok(SignedPsbt { psbt_base64: signed })
    })();
    crate::bankon_vault::secure_mem::wipe(&mut secret); // volatile: a plain loop is a dead store
    result
}
