//! chain_ar — Arweave chain pack (RSA-4096, RSA-PSS).
//!
//! ## What moved to Rust, and what deliberately did not
//!
//! **Signing moved.** RSA-PSS over SHA-256 with a 32-byte salt, from a JWK held
//! in the vault. This is the security win: the private exponent no longer has to
//! exist as a JavaScript object to sign anything, and it works regardless of how
//! the key was originally derived.
//!
//! **Generation of NEW accounts moved**, using the OS CSPRNG.
//!
//! **Mnemonic → RSA recovery deliberately did NOT move**, and
//! `src/lib/arweave/seed.ts` remains the authority for it. That path derives an
//! RSA-4096 key *deterministically* from a BIP-39 seed by feeding node-forge's
//! seedable generator a PRNG stretched from the seed bytes. Determinism there is
//! a property of node-forge's specific prime search: given the same PRNG stream,
//! a different implementation walks to different primes. Rust's `rsa` crate would
//! therefore produce a **different key from the same mnemonic**, and any existing
//! Arweave account recovered through Rust would be a different address with none
//! of the participant's funds.
//!
//! Reimplementing node-forge's prime search in Rust to preserve that mapping is
//! possible and is the wrong trade: it would pin PARSEC forever to another
//! library's internals in the one place where a mistake silently loses money.
//! So the legacy derivation stays where it is, and new accounts get keys from the
//! OS CSPRNG — which is stronger anyway, since it does not stretch 64 seed bytes
//! into a 4096-bit key through a hand-rolled PRNG.
//!
//! Consequence to state plainly in the UI: a Rust-generated Arweave key is **not**
//! recoverable from a mnemonic. Its JWK is the backup, and the vault is where it
//! lives.

pub mod commands;
pub mod jwk;
pub mod keys;
pub mod sign;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArAccountInfo {
    pub address: String,
    /// The RSA modulus, base64url — Arweave's "owner" field. Public data.
    pub owner: String,
    pub bits: usize,
}
