// chain_sol::seed — SLIP-0010 ed25519 derivation.
//
// SLIP-0010's ed25519 profile differs from BIP-32 in two ways that matter:
// every index must be hardened (there is no public-parent derivation for
// Edwards keys), and the master key comes from HMAC-SHA512 under the fixed key
// `"ed25519 seed"` rather than `"Bitcoin seed"`.
//
// The HMAC is the one already implemented in `bankon_vault::kdf`, pinned by RFC
// 4231 vectors — no second implementation and no extra dependency.

use crate::bankon_vault::kdf::hmac_sha512;
use crate::bankon_vault::secure_mem::{wipe, SecretBytes};

const HARDENED: u32 = 0x8000_0000;
const MASTER_KEY: &[u8] = b"ed25519 seed";

/// `m/44'/501'/0'/0'` — the Phantom / Solflare account path.
pub const SOLANA_PATH: [u32; 4] = [44, 501, 0, 0];

/// Render a path for display, e.g. `m/44'/501'/0'/0'`.
pub fn path_string(path: &[u32]) -> String {
    let mut s = String::from("m");
    for level in path {
        s.push_str(&format!("/{level}'"));
    }
    s
}

/// Derive a 32-byte ed25519 secret seed from a BIP-39 seed along `path`.
///
/// Every level is hardened implicitly; pass plain indices.
pub fn derive(bip39_seed: &[u8], path: &[u32]) -> Result<SecretBytes, String> {
    if bip39_seed.len() < 16 {
        return Err("BIP-39 seed is too short".to_string());
    }

    let mut i = hmac_sha512(MASTER_KEY, bip39_seed);
    let mut key = [0u8; 32];
    let mut chain = [0u8; 32];
    key.copy_from_slice(&i[..32]);
    chain.copy_from_slice(&i[32..]);
    wipe(&mut i);

    for level in path {
        let index = level | HARDENED;
        // 0x00 || key || ser32(index)
        let mut data = Vec::with_capacity(1 + 32 + 4);
        data.push(0u8);
        data.extend_from_slice(&key);
        data.extend_from_slice(&index.to_be_bytes());

        let mut next = hmac_sha512(&chain, &data);
        wipe(&mut data);
        key.copy_from_slice(&next[..32]);
        chain.copy_from_slice(&next[32..]);
        wipe(&mut next);
    }

    let out = SecretBytes::from_slice(&key);
    wipe(&mut key);
    wipe(&mut chain);
    Ok(out)
}

/// Convert a BIP-39 mnemonic to its 64-byte seed (empty passphrase).
pub fn seed_from_mnemonic(phrase: &str) -> Result<SecretBytes, String> {
    let m = bip39::Mnemonic::parse_in_normalized(bip39::Language::English, phrase)
        .map_err(|e| format!("invalid BIP-39 mnemonic: {e}"))?;
    let mut seed = m.to_seed_normalized("");
    let out = SecretBytes::from_slice(&seed);
    wipe(&mut seed);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_renders_all_levels_hardened() {
        assert_eq!(path_string(&SOLANA_PATH), "m/44'/501'/0'/0'");
        assert_eq!(path_string(&[]), "m");
    }

    #[test]
    fn derivation_is_deterministic_and_path_dependent() {
        let seed = seed_from_mnemonic(
            "abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon about",
        )
        .unwrap();
        let a = derive(seed.as_slice(), &SOLANA_PATH).unwrap();
        let b = derive(seed.as_slice(), &SOLANA_PATH).unwrap();
        let c = derive(seed.as_slice(), &[44, 501, 1, 0]).unwrap();
        assert_eq!(a.as_slice(), b.as_slice());
        assert_ne!(a.as_slice(), c.as_slice(), "a different path must diverge");
        assert_eq!(a.len(), 32);
    }

    /// SLIP-0010 test vector 1 for ed25519: the master key for seed
    /// `000102030405060708090a0b0c0d0e0f`.
    #[test]
    fn matches_slip0010_master_key_vector() {
        let seed = hex::decode("000102030405060708090a0b0c0d0e0f").unwrap();
        let master = derive(&seed, &[]).unwrap();
        assert_eq!(
            hex::encode(master.as_slice()),
            "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7"
        );
    }

    /// SLIP-0010 vector 1, chain `m/0'`.
    #[test]
    fn matches_slip0010_first_child_vector() {
        let seed = hex::decode("000102030405060708090a0b0c0d0e0f").unwrap();
        let child = derive(&seed, &[0]).unwrap();
        assert_eq!(
            hex::encode(child.as_slice()),
            "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3"
        );
    }

    #[test]
    fn rejects_an_invalid_mnemonic() {
        assert!(seed_from_mnemonic("not a valid mnemonic").is_err());
    }
}
