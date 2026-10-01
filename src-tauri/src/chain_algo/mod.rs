//! chain_algo — Algorand chain pack.
//!
//! Algorand is PARSEC's first-class chain and does not use BIP-39. Accounts are
//! a 32-byte ed25519 seed rendered as a 25-word mnemonic with a SHA-512/256
//! checksum word, and addresses are base32 of the public key plus a 4-byte
//! checksum.
//!
//! Everything here runs in Rust so that a freshly generated seed never becomes a
//! JavaScript string. `src/lib/algorand/account.ts` previously called
//! `algosdk.generateAccount()` in the renderer, where a secret is immutable,
//! garbage-collected, and impossible to wipe — the gap recorded as A8 in
//! `docs/security/threat-model.md`.
//!
//! Correctness is pinned against `algosdk` itself: mnemonics, addresses and
//! signatures in the tests are ground truth generated with the JavaScript library
//! this module replaces.

pub mod commands;
pub mod keys;
pub mod mnemonic;
pub mod sign;

use serde::{Deserialize, Serialize};

/// A newly created or imported Algorand account. Carries no secret.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlgoAccountInfo {
    pub address: String,
    /// 32-byte ed25519 public key, hex. Public data.
    pub public_key_hex: String,
}
