// chain_sol::sign — ed25519 signatures for Solana.
//
// Solana signs the serialized message directly, with no domain prefix (unlike
// Algorand's `MX`). Signatures are returned as bytes.

use ed25519_dalek::Signer;

use super::keys::signing_key;

pub fn sign(secret_seed: &[u8], payload: &[u8]) -> Result<Vec<u8>, String> {
    Ok(signing_key(secret_seed)?.sign(payload).to_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};

    #[test]
    fn signatures_verify_and_are_deterministic() {
        let s = [11u8; 32];
        let msg = b"solana message";
        let a = sign(&s, msg).unwrap();
        let b = sign(&s, msg).unwrap();
        assert_eq!(a, b, "ed25519 is deterministic");
        assert_eq!(a.len(), 64);

        let vk = signing_key(&s).unwrap().verifying_key();
        assert!(vk.verify(msg, &Signature::from_slice(&a).unwrap()).is_ok());
    }

    #[test]
    fn a_different_message_produces_a_different_signature() {
        let s = [12u8; 32];
        assert_ne!(sign(&s, b"a").unwrap(), sign(&s, b"b").unwrap());
    }
}
