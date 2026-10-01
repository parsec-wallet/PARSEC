//! PSBT signing. Consumes a Base64-encoded PSBT and a mnemonic (via vault),
//! produces a signed PSBT. The `bitcoin` crate walks each input's
//! `bip32_derivation` field and signs whichever inputs match the master
//! fingerprint we derive here.

use base64::prelude::*;
use bitcoin::bip32::Xpriv;
use bitcoin::psbt::Psbt;
use bitcoin::secp256k1::Secp256k1;

use super::keys::derive_xpriv;
use super::BtcNetwork;

/// Sign all inputs in the PSBT that match the given mnemonic's master key.
/// Returns the updated PSBT as Base64. Errors if any input that *was* a
/// match failed to sign — partial signing is not considered success.
pub fn sign_psbt_base64(
    mnemonic: &str,
    passphrase: &str,
    network: BtcNetwork,
    psbt_b64: &str,
) -> Result<String, String> {
    let raw = BASE64_STANDARD
        .decode(psbt_b64.trim())
        .map_err(|e| format!("invalid base64 PSBT: {e}"))?;

    let mut psbt = Psbt::deserialize(&raw).map_err(|e| format!("invalid PSBT: {e}"))?;

    // Master key at m/ for this network. `Psbt::sign` with an `Xpriv` walks
    // the PSBT's bip32_derivation entries and derives the child key per input.
    let master: Xpriv = derive_xpriv(mnemonic, passphrase, network, "m")?;
    let secp = Secp256k1::new();

    match psbt.sign(&master, &secp) {
        Ok(_signed_keys) => {}
        Err((_signed_keys, errs)) => {
            // Any signing error = failure. We don't return a partially signed PSBT
            // pretending everything worked.
            return Err(format!("PSBT signing failed: {errs:?}"));
        }
    }

    Ok(BASE64_STANDARD.encode(psbt.serialize()))
}
