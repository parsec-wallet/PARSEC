// chain_ar::keys — RSA-4096 generation and Arweave addresses.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use rsa::traits::PublicKeyParts;
use rsa::RsaPrivateKey;
use sha2::{Digest, Sha256};

use super::jwk::{self, ArweaveJwk};

/// Arweave uses 4096-bit RSA.
pub const KEY_BITS: usize = 4096;

/// Generate a fresh Arweave key from the OS CSPRNG.
///
/// Slow — several seconds for 4096 bits — because prime search is. That cost is
/// paid once per account and is not a reason to weaken the key.
pub fn generate() -> Result<RsaPrivateKey, String> {
    RsaPrivateKey::new(&mut rand::rngs::OsRng, KEY_BITS)
        .map_err(|e| format!("RSA key generation failed: {e}"))
}

/// The Arweave address: base64url of SHA-256 over the raw modulus.
pub fn address_from_modulus(n_bytes: &[u8]) -> String {
    B64URL.encode(Sha256::digest(n_bytes))
}

pub fn address_from_key(key: &RsaPrivateKey) -> String {
    address_from_modulus(&key.n().to_bytes_be())
}

/// The address for a JWK, computed from its `n` field.
pub fn address_from_jwk(j: &ArweaveJwk) -> Result<String, String> {
    let n = B64URL
        .decode(j.n.as_bytes())
        .map_err(|_| "JWK field \"n\" is not valid base64url".to_string())?;
    Ok(address_from_modulus(&n))
}

/// Parse a JWK from its JSON form.
pub fn jwk_from_json(s: &str) -> Result<ArweaveJwk, String> {
    serde_json::from_str(s).map_err(|e| format!("not a valid Arweave JWK: {e}"))
}

pub fn jwk_to_json(j: &ArweaveJwk) -> Result<String, String> {
    serde_json::to_string(j).map_err(|e| format!("JWK serialize failed: {e}"))
}

pub fn jwk_from_key(key: &RsaPrivateKey) -> Result<ArweaveJwk, String> {
    jwk::from_private_key(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    fn small() -> RsaPrivateKey {
        RsaPrivateKey::new(&mut OsRng, 2048).unwrap()
    }

    /// Arweave addresses are 43 characters: base64url of a 32-byte SHA-256, unpadded.
    #[test]
    fn addresses_are_43_char_base64url() {
        let key = small();
        let addr = address_from_key(&key);
        assert_eq!(addr.len(), 43, "{addr}");
        assert!(!addr.contains('='), "must be unpadded: {addr}");
        assert!(!addr.contains('+') && !addr.contains('/'), "must be url-safe: {addr}");
    }

    /// The property that made the v1 vault destroy keys: Arweave addresses are
    /// base64url and routinely contain `-` and `_`.
    #[test]
    fn address_alphabet_includes_the_characters_that_broke_the_v1_vault() {
        let mut saw_dash_or_underscore = false;
        for _ in 0..40 {
            let addr = address_from_modulus(&rand_bytes(512));
            assert_eq!(addr.len(), 43);
            if addr.contains('-') || addr.contains('_') {
                saw_dash_or_underscore = true;
            }
        }
        assert!(
            saw_dash_or_underscore,
            "base64url addresses must be able to contain - and _ (see store.rs C3)"
        );
    }

    fn rand_bytes(n: usize) -> Vec<u8> {
        use rand::RngCore;
        let mut v = vec![0u8; n];
        OsRng.fill_bytes(&mut v);
        v
    }

    #[test]
    fn address_is_derived_from_the_modulus_and_matches_via_jwk() {
        let key = small();
        let j = jwk_from_key(&key).unwrap();
        assert_eq!(address_from_jwk(&j).unwrap(), address_from_key(&key));
    }

    #[test]
    fn jwk_json_round_trips() {
        let key = small();
        let j = jwk_from_key(&key).unwrap();
        let json = jwk_to_json(&j).unwrap();
        let back = jwk_from_json(&json).unwrap();
        assert_eq!(back.n, j.n);
        assert_eq!(address_from_jwk(&back).unwrap(), address_from_jwk(&j).unwrap());
    }

    #[test]
    fn rejects_json_that_is_not_a_jwk() {
        assert!(jwk_from_json("{}").is_err());
        assert!(jwk_from_json("not json").is_err());
    }

    #[test]
    fn production_key_size_is_4096() {
        assert_eq!(KEY_BITS, 4096);
    }
}
