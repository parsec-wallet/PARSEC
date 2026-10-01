//! Litecoin address encoding.
//!
//! - Legacy (P2PKH): base58check, version 0x30 (mainnet) / 0x6f (testnet).
//! - Segwit-compat (P2SH-P2WPKH): base58check, version 0x32 (mainnet) / 0x3a (testnet).
//! - Native segwit (P2WPKH): bech32, HRP "ltc" (mainnet) / "tltc" (testnet), witness version 0.

use bitcoin::base58;
use bitcoin::bech32::{self, Hrp};
use bitcoin::bip32::Xpriv;
use bitcoin::hashes::{hash160, ripemd160, sha256, Hash};
use bitcoin::secp256k1::Secp256k1;

use super::{LtcAddressKind, LtcNetwork};

fn p2pkh_version(network: LtcNetwork) -> u8 {
    match network {
        LtcNetwork::Mainnet => 0x30,
        LtcNetwork::Testnet => 0x6f,
    }
}

fn p2sh_version(network: LtcNetwork) -> u8 {
    match network {
        LtcNetwork::Mainnet => 0x32,
        LtcNetwork::Testnet => 0x3a,
    }
}

fn bech32_hrp(network: LtcNetwork) -> &'static str {
    match network {
        LtcNetwork::Mainnet => "ltc",
        LtcNetwork::Testnet => "tltc",
    }
}

pub fn format_address(
    xpriv: &Xpriv,
    network: LtcNetwork,
    kind: LtcAddressKind,
) -> Result<String, String> {
    let secp = Secp256k1::new();
    let pubkey = xpriv.to_keypair(&secp).public_key();
    let pubkey_bytes = pubkey.serialize();
    let pubkey_hash = hash160::Hash::hash(&pubkey_bytes);

    match kind {
        LtcAddressKind::Legacy => {
            let mut payload = Vec::with_capacity(21);
            payload.push(p2pkh_version(network));
            payload.extend_from_slice(pubkey_hash.as_ref());
            Ok(base58::encode_check(&payload))
        }
        LtcAddressKind::SegwitCompat => {
            // P2SH of P2WPKH: script = OP_0 <20-byte pubkey hash>
            let mut redeem_script = Vec::with_capacity(22);
            redeem_script.push(0x00); // OP_0
            redeem_script.push(0x14); // push 20 bytes
            redeem_script.extend_from_slice(pubkey_hash.as_ref());
            // Litecoin P2SH uses HASH160(redeem_script) — same double-hash as Bitcoin:
            // RIPEMD160(SHA256(script)).
            let script_hash = ripemd160::Hash::hash(sha256::Hash::hash(&redeem_script).as_ref());
            let mut payload = Vec::with_capacity(21);
            payload.push(p2sh_version(network));
            payload.extend_from_slice(script_hash.as_ref());
            Ok(base58::encode_check(&payload))
        }
        LtcAddressKind::NativeSegwit => {
            let hrp = Hrp::parse(bech32_hrp(network)).map_err(|e| format!("bad hrp: {e}"))?;
            // Witness v0 P2WPKH: 20-byte program = pubkey hash.
            bech32::segwit::encode_v0(hrp, pubkey_hash.as_ref())
                .map_err(|e| format!("bech32 encode: {e}"))
        }
    }
}

