//! chain_ltc — Litecoin chain pack
//!
//! Litecoin is secp256k1/BIP-39 like Bitcoin; the only differences visible
//! from the crypto layer are the BIP-44 coin type (2' instead of 0') and
//! the address encoding (own bech32 HRP `ltc`/`tltc`, base58 version bytes
//! 0x30 for P2PKH mainnet, 0x32 for P2SH mainnet).
//!
//! HD derivation uses the `bitcoin` crate's generic `Xpriv::new_master`
//! (the math is chain-agnostic); address formatting is our own so we get
//! the Litecoin prefixes right. PSBT signing is reused verbatim from
//! chain_btc::sign because PSBT/BIP-174 is network-agnostic at the
//! signing layer.

pub mod address;
pub mod commands;
pub mod keys;
pub mod sign;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LtcNetwork {
    Mainnet,
    Testnet,
}

impl LtcNetwork {
    /// BIP-44 coin type. 2' on mainnet, 1' on testnet.
    pub fn coin_type(self) -> u32 {
        match self {
            Self::Mainnet => 2,
            Self::Testnet => 1,
        }
    }
}

/// Same three script forms as BTC. Duplicated here (rather than imported
/// from chain_btc) so the chain packs stay independently buildable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LtcAddressKind {
    /// BIP-84 — native segwit (ltc1q…)
    NativeSegwit,
    /// BIP-49 — segwit wrapped in P2SH (M… on mainnet)
    SegwitCompat,
    /// BIP-44 — legacy (L… on mainnet)
    Legacy,
}

impl LtcAddressKind {
    pub fn purpose(self) -> u32 {
        match self {
            Self::NativeSegwit => 84,
            Self::SegwitCompat => 49,
            Self::Legacy => 44,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LtcAddressInfo {
    pub address: String,
    pub path: String,
    pub network: LtcNetwork,
    pub kind: LtcAddressKind,
}
