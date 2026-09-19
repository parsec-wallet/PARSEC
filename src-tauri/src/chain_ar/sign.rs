// chain_ar::sign — RSA-PSS signatures for Arweave.
//
// Arweave and ANS-104 use RSA-PSS over SHA-256 with a 32-byte salt (signature
// type 1, 512-byte signature, 512-byte owner). The salt length equals the digest
// size, which is what `rsa`'s `pss::SigningKey<Sha256>` uses by default — the
// same parameters `src/lib/arweave/ans104.ts` passes to WebCrypto.

use rsa::pss::SigningKey;
use rsa::signature::{RandomizedSigner, SignatureEncoding};
use rsa::RsaPrivateKey;
use sha2::Sha256;

/// Arweave signature length for a 4096-bit key.
pub const SIGNATURE_LEN_4096: usize = 512;

/// Sign a message with RSA-PSS / SHA-256, 32-byte salt.
///
/// PSS is randomized, so two signatures over the same message differ. Both
/// verify; this is by design and is not a determinism bug.
pub fn sign(key: &RsaPrivateKey, message: &[u8]) -> Result<Vec<u8>, String> {
    let signing_key = SigningKey::<Sha256>::new(key.clone());
    let sig = signing_key.sign_with_rng(&mut rand::rngs::OsRng, message);
    Ok(sig.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rsa::pss::VerifyingKey;
    use rsa::signature::Verifier;
    use rsa::RsaPublicKey;

    fn small() -> RsaPrivateKey {
        RsaPrivateKey::new(&mut rand::rngs::OsRng, 2048).unwrap()
    }

    #[test]
    fn signatures_verify_under_the_public_key() {
        let key = small();
        let msg = b"arweave data item";
        let sig = sign(&key, msg).unwrap();

        let vk = VerifyingKey::<Sha256>::new(RsaPublicKey::from(&key));
        let parsed = rsa::pss::Signature::try_from(sig.as_slice()).unwrap();
        assert!(vk.verify(msg, &parsed).is_ok());
    }

    #[test]
    fn a_tampered_message_does_not_verify() {
        let key = small();
        let sig = sign(&key, b"pay alice").unwrap();
        let vk = VerifyingKey::<Sha256>::new(RsaPublicKey::from(&key));
        let parsed = rsa::pss::Signature::try_from(sig.as_slice()).unwrap();
        assert!(vk.verify(b"pay mallory", &parsed).is_err());
    }

    /// PSS is randomized by design. Asserting this stops anyone "fixing" it into
    /// a deterministic scheme, which would weaken it.
    #[test]
    fn pss_signatures_are_randomized_and_both_verify() {
        let key = small();
        let msg = b"same message";
        let a = sign(&key, msg).unwrap();
        let b = sign(&key, msg).unwrap();
        assert_ne!(a, b, "PSS must use a fresh salt each time");

        let vk = VerifyingKey::<Sha256>::new(RsaPublicKey::from(&key));
        for s in [a, b] {
            let parsed = rsa::pss::Signature::try_from(s.as_slice()).unwrap();
            assert!(vk.verify(msg, &parsed).is_ok());
        }
    }

    #[test]
    fn signature_length_tracks_the_modulus() {
        let key = small();
        assert_eq!(sign(&key, b"m").unwrap().len(), 256, "2048-bit key → 256 bytes");
        assert_eq!(SIGNATURE_LEN_4096, 512);
    }
}
