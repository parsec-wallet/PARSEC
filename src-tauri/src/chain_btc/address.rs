//! Address formatting per BIP-44 / BIP-49 / BIP-84.

use bitcoin::bip32::Xpriv;
use bitcoin::secp256k1::Secp256k1;
use bitcoin::{Address, CompressedPublicKey};

use super::{AddressKind, BtcNetwork};

/// Encode an Xpriv's pubkey into the chosen address form.
pub fn format_address(
    xpriv: &Xpriv,
    network: BtcNetwork,
    kind: AddressKind,
) -> Result<String, String> {
    let secp = Secp256k1::new();
    let xpub = xpriv.to_keypair(&secp).public_key();
    let compressed = CompressedPublicKey::from_slice(&xpub.serialize())
        .map_err(|e| format!("compressed pubkey: {e}"))?;
    let net = network.as_bitcoin();

    let addr = match kind {
        AddressKind::NativeSegwit => Address::p2wpkh(&compressed, net),
        AddressKind::SegwitCompat => Address::p2shwpkh(&compressed, net),
        AddressKind::Legacy => Address::p2pkh(compressed, net),
    };
    Ok(addr.to_string())
}
