//! chain_btc — Bitcoin chain pack
//!
//! Scaffolded key derivation for Parsec's first non-Algorand chain. Mnemonics
//! follow BIP-39, HD keys follow BIP-32, derivation paths follow
//! BIP-44 (legacy), BIP-49 (segwit-compat), and BIP-84 (native segwit).
//!
//! Secrets stay in this module. The frontend only ever sees derived public
//! data (addresses, xpubs, path strings). Private key material is derived
//! into a stack-allocated secret and dropped before the command returns.
//!
//! Signing is not implemented yet — this is a derivation+address scaffold.
//! `bitgo-utxo-lib` at `reference/atomicwallet/bitgo-utxo-lib/` is the JS
//! reference we read while writing this; the runtime uses the `bitcoin`
//! crate.

pub mod address;
pub mod commands;
pub mod keys;
pub mod sign;

use serde::{Deserialize, Serialize};

/// Bitcoin network variant. Used to pick network params for address encoding
/// and the BIP-44 coin-type component (0' for mainnet, 1' for test/regtest).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BtcNetwork {
    Mainnet,
    Testnet,
    Regtest,
}

impl BtcNetwork {
    pub fn as_bitcoin(self) -> bitcoin::Network {
        match self {
            Self::Mainnet => bitcoin::Network::Bitcoin,
            Self::Testnet => bitcoin::Network::Testnet,
            Self::Regtest => bitcoin::Network::Regtest,
        }
    }

    /// BIP-44 coin type. 0' on mainnet, 1' on testnet/regtest.
    pub fn coin_type(self) -> u32 {
        match self {
            Self::Mainnet => 0,
            _ => 1,
        }
    }
}

/// Which script/address scheme to derive. Native segwit is the default for
/// new accounts; the other two exist for importing or displaying legacy
/// addresses held elsewhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AddressKind {
    /// BIP-84 — native segwit (bc1q…)
    NativeSegwit,
    /// BIP-49 — segwit wrapped in P2SH (3…)
    SegwitCompat,
    /// BIP-44 — legacy (1…)
    Legacy,
}

impl AddressKind {
    /// BIP-43 purpose index used in the derivation path.
    pub fn purpose(self) -> u32 {
        match self {
            Self::NativeSegwit => 84,
            Self::SegwitCompat => 49,
            Self::Legacy => 44,
        }
    }
}

/// Public-only description of a derived account. Safe to return to JS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BtcAddressInfo {
    pub address: String,
    pub path: String,
    pub network: BtcNetwork,
    pub kind: AddressKind,
}
