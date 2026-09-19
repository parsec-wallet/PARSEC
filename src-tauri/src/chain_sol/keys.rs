// chain_sol::keys — ed25519 keypairs and base58 addresses.

use ed25519_dalek::{SigningKey, VerifyingKey};

use crate::bankon_vault::secure_mem::wipe;

pub const SEED_LEN: usize = 32;

pub fn signing_key(secret_seed: &[u8]) -> Result<SigningKey, String> {
    if secret_seed.len() != SEED_LEN {
        return Err(format!(
            "Solana secret seed must be {SEED_LEN} bytes, got {}",
            secret_seed.len()
        ));
    }
    let mut arr = [0u8; SEED_LEN];
    arr.copy_from_slice(secret_seed);
    let key = SigningKey::from_bytes(&arr);
    wipe(&mut arr);
    Ok(key)
}

/// A Solana address is the base58 of the raw 32-byte public key — plain base58,
/// with no version byte and no checksum, unlike Bitcoin's Base58Check.
pub fn address_from_public(public: &VerifyingKey) -> String {
    bitcoin::base58::encode(&public.to_bytes())
}

pub fn address_from_seed(secret_seed: &[u8]) -> Result<String, String> {
    Ok(address_from_public(&signing_key(secret_seed)?.verifying_key()))
}

pub fn public_from_seed(secret_seed: &[u8]) -> Result<[u8; 32], String> {
    Ok(signing_key(secret_seed)?.verifying_key().to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::seed;

    const ABANDON: &str = "abandon abandon abandon abandon abandon abandon abandon \
                           abandon abandon abandon abandon about";
    /// Derived independently of Parsec (Node crypto + tweetnacl + @solana/web3.js)
    /// and already pinned by `src/lib/solana/__tests__/seed.test.ts`. The Rust
    /// path must produce the same address, or funds sent by an external wallet
    /// would land somewhere Parsec cannot spend.
    const EXPECTED: &str = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";

    #[test]
    fn matches_the_canonical_phantom_derivation() {
        let bip39 = seed::seed_from_mnemonic(ABANDON).unwrap();
        let sk = seed::derive(bip39.as_slice(), &seed::SOLANA_PATH).unwrap();
        assert_eq!(address_from_seed(sk.as_slice()).unwrap(), EXPECTED);
    }

    #[test]
    fn agrees_with_the_typescript_implementation_it_replaces() {
        // Same constant the vitest suite asserts, so the two implementations are
        // provably in step rather than merely both self-consistent.
        assert_eq!(EXPECTED, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
    }

    #[test]
    fn addresses_are_valid_base58_of_the_expected_length() {
        for i in 0..16u8 {
            let s = [i.wrapping_mul(17).wrapping_add(2); SEED_LEN];
            let addr = address_from_seed(&s).unwrap();
            assert!((32..=44).contains(&addr.len()), "{addr}");
            assert!(!addr.contains(['0', 'O', 'I', 'l']), "base58 excludes these: {addr}");
            assert_eq!(bitcoin::base58::decode(&addr).unwrap().len(), 32);
        }
    }

    #[test]
    fn rejects_a_wrong_length_seed() {
        assert!(signing_key(&[0u8; 31]).is_err());
    }
}
