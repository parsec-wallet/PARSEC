//! HD key derivation for Litecoin. The curve and math are identical to
//! Bitcoin, so we use `bitcoin::bip32` directly and only diverge on the
//! derivation path's coin type.

use bip39::{Language, Mnemonic};
use bitcoin::bip32::{DerivationPath, Xpriv};
use bitcoin::secp256k1::Secp256k1;
use bitcoin::Network as BitcoinNetwork;
use std::str::FromStr;

/// Derive an Xpriv at the given path. Master construction uses
/// `Network::Bitcoin` because the underlying secret-key math is chain-
/// agnostic; the LTC-specific bits live in the derivation path and in
/// the address encoder.
pub fn derive_xpriv(
    mnemonic: &str,
    passphrase: &str,
    path: &str,
) -> Result<Xpriv, String> {
    let parsed = Mnemonic::parse_in_normalized(Language::English, mnemonic)
        .map_err(|e| format!("invalid mnemonic: {e}"))?;
    let seed = parsed.to_seed(passphrase);
    let master = Xpriv::new_master(BitcoinNetwork::Bitcoin, &seed)
        .map_err(|e| format!("master key derivation failed: {e}"))?;
    let path = DerivationPath::from_str(path).map_err(|e| format!("bad path: {e}"))?;
    let secp = Secp256k1::new();
    master
        .derive_priv(&secp, &path)
        .map_err(|e| format!("derivation failed: {e}"))
}

pub fn account_path(purpose: u32, coin_type: u32, account: u32, index: u32) -> String {
    format!("m/{purpose}'/{coin_type}'/{account}'/0/{index}")
}
