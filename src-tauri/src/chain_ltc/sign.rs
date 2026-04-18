//! PSBT signing for Litecoin. PSBT (BIP-174) is network-agnostic at the
//! signing layer — each input carries its own `bip32_derivation` metadata
//! so `Psbt::sign` just needs a master Xpriv whose derivations reach the
//! inputs' keys. We use `Network::Bitcoin` to construct the master because
//! the curve math is identical; LTC's coin-type 2' lives only in the
//! derivation path the signer walks.

use base64::prelude::*;
use bip39::{Language, Mnemonic};
use bitcoin::bip32::Xpriv;
use bitcoin::psbt::Psbt;
use bitcoin::secp256k1::Secp256k1;
use bitcoin::Network as BitcoinNetwork;

pub fn sign_psbt_base64(
    mnemonic: &str,
    passphrase: &str,
    psbt_b64: &str,
) -> Result<String, String> {
    let raw = BASE64_STANDARD
        .decode(psbt_b64.trim())
        .map_err(|e| format!("invalid base64 PSBT: {e}"))?;
    let mut psbt = Psbt::deserialize(&raw).map_err(|e| format!("invalid PSBT: {e}"))?;

    let parsed = Mnemonic::parse_in_normalized(Language::English, mnemonic)
        .map_err(|e| format!("invalid mnemonic: {e}"))?;
    let seed = parsed.to_seed(passphrase);
    let master: Xpriv = Xpriv::new_master(BitcoinNetwork::Bitcoin, &seed)
        .map_err(|e| format!("master derivation: {e}"))?;

    let secp = Secp256k1::new();
    match psbt.sign(&master, &secp) {
        Ok(_) => {}
        Err((_signed, errs)) => return Err(format!("PSBT signing failed: {errs:?}")),
    }
    Ok(BASE64_STANDARD.encode(psbt.serialize()))
}
