//! Tauri IPC commands. The frontend receives addresses and metadata only;
//! all secret material stays inside this module.

use serde::Deserialize;

use super::address::format_address;
use super::keys::{account_path, derive_xpriv, generate_mnemonic, validate_mnemonic, MnemonicWords};
use super::{AddressKind, BtcAddressInfo, BtcNetwork};

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
pub fn chain_btc_generate_mnemonic(words: u32) -> Result<String, String> {
    let wc = match words {
        12 => MnemonicWords::Twelve,
        24 => MnemonicWords::TwentyFour,
        n => return Err(format!("unsupported word count: {n} (use 12 or 24)")),
    };
    generate_mnemonic(wc)
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
