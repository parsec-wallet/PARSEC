// chain_algo::keys — ed25519 accounts and Algorand addresses.
//
// Runs in Rust so a freshly generated seed never exists as a JavaScript string.
// `src/lib/algorand/account.ts` previously called `algosdk.generateAccount()` in
// the renderer, where the secret is an immutable, garbage-collected value that
// cannot be wiped.

use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::RngCore;
use sha2::{Digest, Sha512_256};

use crate::bankon_vault::secure_mem::SecretBytes;

pub const SEED_LEN: usize = 32;
pub const ADDRESS_LEN: usize = 58;
const CHECKSUM_LEN: usize = 4;
const BASE32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// RFC 4648 base32, uppercase, no padding.
fn base32_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(5) * 8);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &b in data {
        acc = (acc << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32[((acc >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(BASE32[((acc << (5 - bits)) & 0x1f) as usize] as char);
    }
    out
}

/// Generate a fresh 32-byte account seed from the OS CSPRNG.
///
/// Returned in pinned, self-wiping memory — it must reach the vault without
/// being copied into an ordinary buffer along the way.
pub fn generate_seed() -> SecretBytes {
    let mut seed = SecretBytes::zeroed(SEED_LEN);
    rand::rngs::OsRng.fill_bytes(seed.as_mut_slice());
    seed
}

/// The ed25519 signing key for a seed.
pub fn signing_key(seed: &[u8]) -> Result<SigningKey, String> {
    if seed.len() != SEED_LEN {
        return Err(format!("Algorand seed must be {SEED_LEN} bytes, got {}", seed.len()));
    }
    let mut arr = [0u8; SEED_LEN];
    arr.copy_from_slice(seed);
    let key = SigningKey::from_bytes(&arr);
    // The copy we made is key material; do not leave it on the stack.
    crate::bankon_vault::secure_mem::wipe(&mut arr);
    Ok(key)
}

/// The 58-character address for a public key: base32(pubkey ‖ checksum), where
/// the checksum is the last 4 bytes of SHA-512/256(pubkey).
pub fn address_from_public(public: &VerifyingKey) -> String {
    let pk = public.to_bytes();
    let digest = Sha512_256::digest(pk);
    let mut buf = Vec::with_capacity(SEED_LEN + CHECKSUM_LEN);
    buf.extend_from_slice(&pk);
    buf.extend_from_slice(&digest[28..32]);
    base32_encode(&buf)
}

/// The address for a seed.
pub fn address_from_seed(seed: &[u8]) -> Result<String, String> {
    Ok(address_from_public(&signing_key(seed)?.verifying_key()))
}

/// The 32-byte public key for a seed.
pub fn public_from_seed(seed: &[u8]) -> Result<[u8; 32], String> {
    Ok(signing_key(seed)?.verifying_key().to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Addresses generated with algosdk for the same seeds.
    const VECTORS: &[(&str, &str)] = &[
        (
            "0000000000000000000000000000000000000000000000000000000000000000",
            "HNVCPPGOW2SC2YVDVDICU3YNONSTEFLXDXREHJR2YBEKDC2Z3IUZSC6YGI",
        ),
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            "O2QVSICEU3SPKEJGLPFHHJQE3EFQKKOR35QCXYYKDGUSK5TA2H2Q3YZHOY",
        ),
        (
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
            "AOQQPP7TZYIL4HLQ3UMOOS6ATFT6JVRQTOSQ2XY53SDGIESVGG4MPFYUMQ",
        ),
        (
            "0707070707070707070707070707070707070707070707070707070707070707",
            "5JFGYY7CTRJAVPXVKB5RGLWF7GKUO5VOX27HXESCD3VGSFCG2IWAKDM5YU",
        ),
    ];

    #[test]
    fn addresses_match_algosdk() {
        for (seed_hex, expected) in VECTORS {
            let seed = hex::decode(seed_hex).unwrap();
            assert_eq!(address_from_seed(&seed).unwrap(), *expected, "seed {seed_hex}");
        }
    }

    #[test]
    fn addresses_are_58_characters_of_the_algorand_alphabet() {
        for i in 0..32u8 {
            let seed = [i.wrapping_mul(11).wrapping_add(5); SEED_LEN];
            let addr = address_from_seed(&seed).unwrap();
            assert_eq!(addr.len(), ADDRESS_LEN, "{addr}");
            assert!(
                addr.chars().all(|c| c.is_ascii_uppercase() || ('2'..='7').contains(&c)),
                "{addr}"
            );
        }
    }

    /// The address must pass the validator the rest of the app gates on.
    #[test]
    fn generated_addresses_pass_parsec_validate() {
        for i in 0..16u8 {
            let seed = [i.wrapping_mul(13).wrapping_add(1); SEED_LEN];
            let addr = address_from_seed(&seed).unwrap();
            let result = crate::parsec_validate::validate_algorand_address(&addr);
            assert!(result.valid, "{addr}: {}", result.reason);
        }
    }

    #[test]
    fn generated_seeds_are_the_right_length_and_not_constant() {
        let a = generate_seed();
        let b = generate_seed();
        assert_eq!(a.len(), SEED_LEN);
        assert_ne!(a.as_slice(), b.as_slice(), "seeds must not repeat");
        assert!(a.as_slice().iter().any(|&x| x != 0), "seed must not be all zeroes");
    }

    #[test]
    fn rejects_a_wrong_length_seed() {
        assert!(signing_key(&[0u8; 31]).is_err());
        assert!(address_from_seed(&[0u8; 33]).is_err());
    }

    #[test]
    fn base32_encoding_matches_rfc4648_without_padding() {
        // RFC 4648 §10 test vectors, padding stripped.
        assert_eq!(base32_encode(b""), "");
        assert_eq!(base32_encode(b"f"), "MY");
        assert_eq!(base32_encode(b"fo"), "MZXQ");
        assert_eq!(base32_encode(b"foo"), "MZXW6");
        assert_eq!(base32_encode(b"foob"), "MZXW6YQ");
        assert_eq!(base32_encode(b"fooba"), "MZXW6YTB");
        assert_eq!(base32_encode(b"foobar"), "MZXW6YTBOI");
    }
}
