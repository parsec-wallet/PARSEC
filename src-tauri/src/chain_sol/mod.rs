//! chain_sol — Solana chain pack.
//!
//! BIP-39 mnemonic → 64-byte seed → SLIP-0010 ed25519 descent along
//! `m/44'/501'/0'/0'`, every level hardened (SLIP-0010 permits nothing else for
//! ed25519). This is the Phantom / Solflare convention, so an address PARSEC
//! shows is one an external sender's wallet derives identically.
//!
//! Moved out of `src/lib/solana/seed.ts` so the derived secret never exists as a
//! JavaScript value. The TS module's own comment conceded the problem — *"the
//! returned Uint8Array is sensitive — caller MUST `.fill(0)` after use"* — which
//! is a convention, not an enforcement.

pub mod commands;
pub mod keys;
pub mod seed;
pub mod sign;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolAccountInfo {
    pub address: String,
    pub public_key_hex: String,
    /// The derivation path this address came from.
    pub path: String,
}
