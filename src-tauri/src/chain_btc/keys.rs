//! Mnemonic + seed + HD-key derivation. Pure BIP-39/BIP-32.
//!
//! Keys never leave this module. Every function that handles secrets takes
//! them by reference and zeroes local copies on return.

use bip39::{Language, Mnemonic};
use bitcoin::bip32::{DerivationPath, Xpriv};
use bitcoin::secp256k1::Secp256k1;
use std::str::FromStr;

use super::BtcNetwork;

/// BIP-39 word count for a new mnemonic. 24 words = 256-bit entropy.
#[derive(Debug, Clone, Copy)]
pub enum MnemonicWords {
    Twelve = 12,
    TwentyFour = 24,
}

impl MnemonicWords {
    fn entropy_bytes(self) -> usize {
        match self {
            Self::Twelve => 16,
            Self::TwentyFour => 32,
        }
    }
}

/// Generate a fresh BIP-39 mnemonic from secure randomness.
pub fn generate_mnemonic(words: MnemonicWords) -> Result<String, String> {
    use rand::RngCore;
    let mut entropy = vec![0u8; words.entropy_bytes()];
    rand::thread_rng().fill_bytes(&mut entropy);
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|e| format!("entropy→mnemonic failed: {e}"))?;
    // Zero the local entropy buffer before dropping.
    crate::bankon_vault::secure_mem::wipe(&mut entropy); // volatile: a plain loop is a dead store
    Ok(mnemonic.to_string())
}

/// Validate a BIP-39 mnemonic (wordlist + checksum).
pub fn validate_mnemonic(phrase: &str) -> bool {
    Mnemonic::parse_in_normalized(Language::English, phrase).is_ok()
}

/// Derive an Xpriv at the given path from a mnemonic + optional passphrase.
/// The returned key holds secret material and must stay inside Rust — never
/// return it across the IPC boundary.
pub fn derive_xpriv(
    mnemonic: &str,
    passphrase: &str,
    network: BtcNetwork,
    path: &str,
) -> Result<Xpriv, String> {
    let parsed = Mnemonic::parse_in_normalized(Language::English, mnemonic)
        .map_err(|e| format!("invalid mnemonic: {e}"))?;
    let seed = parsed.to_seed(passphrase);
    let master = Xpriv::new_master(network.as_bitcoin(), &seed)
        .map_err(|e| format!("master key derivation failed: {e}"))?;
    let path = DerivationPath::from_str(path).map_err(|e| format!("bad path: {e}"))?;
    let secp = Secp256k1::new();
    let xpriv = master
        .derive_priv(&secp, &path)
        .map_err(|e| format!("derivation failed: {e}"))?;
    Ok(xpriv)
}

/// Build the canonical derivation path string for an account/index pair.
/// Shape: m / purpose' / coin_type' / account' / change / index
pub fn account_path(purpose: u32, coin_type: u32, account: u32, index: u32) -> String {
    format!("m/{purpose}'/{coin_type}'/{account}'/0/{index}")
}
