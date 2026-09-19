// chain_algo::sign — ed25519 signatures for Algorand.
//
// Signatures are returned as `bytes`, never as a structured tuple. cp4096
// commitment V: *"never persist or pass a signature as a `(v, r, s)` tuple"* —
// and when Falcon-1024 lands, a signature stops being 64 bytes. Nothing here
// assumes a length.

use ed25519_dalek::Signer;

use super::keys::signing_key;

/// Domain separator Algorand applies to arbitrary-message signatures.
///
/// Matches `algosdk.signBytes`. Its purpose is to make a signature over a
/// user-supplied message structurally incapable of being replayed as a
/// transaction signature, since transactions are prefixed with `TX`.
pub const MSG_PREFIX: &[u8] = b"MX";

/// Sign an arbitrary message the way `algosdk.signBytes` does.
pub fn sign_bytes(seed: &[u8], message: &[u8]) -> Result<Vec<u8>, String> {
    let key = signing_key(seed)?;
    let mut payload = Vec::with_capacity(MSG_PREFIX.len() + message.len());
    payload.extend_from_slice(MSG_PREFIX);
    payload.extend_from_slice(message);
    Ok(key.sign(&payload).to_bytes().to_vec())
}

/// Sign bytes exactly as given, with no prefix.
///
/// For a pre-built transaction, which already carries its own `TX` domain tag.
/// Kept separate from [`sign_bytes`] so a caller cannot double-prefix or, worse,
/// obtain a transaction-valid signature over a message a participant believed was
/// only being signed for authentication.
pub fn sign_raw(seed: &[u8], payload: &[u8]) -> Result<Vec<u8>, String> {
    Ok(signing_key(seed)?.sign(payload).to_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};

    /// Ground truth from `algosdk.signBytes` over the same seed and message.
    #[test]
    fn sign_bytes_matches_algosdk() {
        let seed = hex::decode(
            "0707070707070707070707070707070707070707070707070707070707070707",
        )
        .unwrap();
        let sig = sign_bytes(&seed, b"parsec-algorand-signing-vector").unwrap();
        assert_eq!(
            hex::encode(&sig),
            "0020c5d9b2f13148b786285e9929bb79fb1acd5d2f095d085b7283cb0333c0f3b1\
             9e00738c3257af0a4f96cf0ba5eeb8d87e21b24efdac960fe5f4b6cda6ad06"
                .replace(['\n', ' '], "")
        );
    }

    #[test]
    fn signatures_verify_against_the_public_key() {
        let seed = [9u8; 32];
        let msg = b"hello algorand";
        let sig = sign_bytes(&seed, msg).unwrap();

        let vk = signing_key(&seed).unwrap().verifying_key();
        let mut payload = Vec::from(MSG_PREFIX);
        payload.extend_from_slice(msg);
        let parsed = Signature::from_slice(&sig).unwrap();
        assert!(vk.verify(&payload, &parsed).is_ok());
    }

    /// The prefix is the whole point: a signature made for authentication must
    /// not verify as a signature over the bare payload.
    #[test]
    fn the_message_prefix_actually_separates_the_domains() {
        let seed = [5u8; 32];
        let msg = b"transfer everything";
        let prefixed = sign_bytes(&seed, msg).unwrap();
        let raw = sign_raw(&seed, msg).unwrap();
        assert_ne!(prefixed, raw, "prefixed and raw signatures must differ");

        let vk = signing_key(&seed).unwrap().verifying_key();
        let parsed = Signature::from_slice(&prefixed).unwrap();
        assert!(
            vk.verify(msg, &parsed).is_err(),
            "a prefixed signature must not verify over the bare message"
        );
    }

    #[test]
    fn signing_is_deterministic() {
        // ed25519 is deterministic, which is what makes signature-bound vault
        // custody viable at all.
        let seed = [3u8; 32];
        assert_eq!(sign_bytes(&seed, b"x").unwrap(), sign_bytes(&seed, b"x").unwrap());
    }

    #[test]
    fn signatures_are_returned_as_bytes_with_no_assumed_shape() {
        let sig = sign_bytes(&[1u8; 32], b"m").unwrap();
        // ed25519 happens to be 64 bytes today; the type is Vec<u8> so that a
        // Falcon-1024 signature (~1,280 bytes) needs no signature-shaped change.
        assert_eq!(sig.len(), 64);
        let _: &[u8] = &sig;
    }

    #[test]
    fn rejects_a_wrong_length_seed() {
        assert!(sign_bytes(&[0u8; 31], b"m").is_err());
    }
}
