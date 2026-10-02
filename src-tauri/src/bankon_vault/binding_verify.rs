// bankon_vault::binding_verify — check a wallet's signature over the key-binding message
// before it becomes a vault custodian (audit H9).
//
// A signature custodian is only as good as the claim that the named address signed the
// named vault's binding message. Without this check, a session could bind "a signature"
// that is really any 32+ bytes, and the custodian label would name an address that never
// agreed to anything.
//
// Accepted forms, matching what the wallets in question produce:
//   algorand — Ed25519 over the message, raw or with the "MX" prefix (algosdk signBytes)
//   solana   — Ed25519 over the message (signMessage)
//   ethereum / evm — EIP-191 personal_sign, 65 bytes r‖s‖v, recovered and compared

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha3::{Digest, Keccak256};

pub fn verify(chain: &str, address: &str, message: &[u8], signature: &[u8]) -> Result<(), String> {
    match chain {
        "algorand" => {
            let raw = crate::parsec_validate::base32_decode(address.trim())
                .filter(|b| b.len() >= 36)
                .ok_or("not an Algorand address")?;
            let pk: [u8; 32] = raw[..32].try_into().map_err(|_| "not an Algorand address")?;
            if crate::chain_algo::keys::address_from_bytes(&pk) != address.trim() {
                return Err("the Algorand address checksum does not match".to_string());
            }
            let mx = [b"MX".as_slice(), message].concat();
            ed25519(&pk, message, signature).or_else(|_| ed25519(&pk, &mx, signature))
        }
        "solana" => {
            let raw = bitcoin::base58::decode(address.trim()).map_err(|_| "not a Solana address")?;
            let pk: [u8; 32] = raw.as_slice().try_into().map_err(|_| "not a Solana address")?;
            ed25519(&pk, message, signature)
        }
        "ethereum" | "evm" => {
            if signature.len() != 65 {
                return Err("an EVM signature is 65 bytes (r‖s‖v)".to_string());
            }
            let v = match signature[64] {
                27 | 28 => signature[64] - 27,
                0 | 1 => signature[64],
                _ => return Err("bad EVM recovery byte".to_string()),
            };
            let mut prefixed = format!("\x19Ethereum Signed Message:\n{}", message.len()).into_bytes();
            prefixed.extend_from_slice(message);
            let hash = Keccak256::digest(&prefixed);
            let sig = k256::ecdsa::Signature::from_slice(&signature[..64]).map_err(|_| "bad EVM signature")?;
            let rid = k256::ecdsa::RecoveryId::from_byte(v).ok_or("bad EVM recovery byte")?;
            let key = k256::ecdsa::VerifyingKey::recover_from_prehash(&hash, &sig, rid)
                .map_err(|_| "the EVM signature does not recover to a key")?;
            let point = key.to_encoded_point(false);
            let recovered = &Keccak256::digest(&point.as_bytes()[1..])[12..];
            let want = hex::decode(address.trim().trim_start_matches("0x")).map_err(|_| "not an EVM address")?;
            if recovered == want.as_slice() {
                Ok(())
            } else {
                Err("the signature was not made by this EVM address".to_string())
            }
        }
        other => Err(format!("wallet-signature custody is not supported for {other}")),
    }
}

fn ed25519(pk: &[u8; 32], message: &[u8], signature: &[u8]) -> Result<(), String> {
    let key = VerifyingKey::from_bytes(pk).map_err(|_| "not a valid Ed25519 public key")?;
    let sig = Signature::from_slice(signature).map_err(|_| "an Ed25519 signature is 64 bytes")?;
    key.verify(message, &sig).map_err(|_| "the signature was not made by this address".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const MSG: &[u8] = b"BANKON-VAULT-KEY-BINDING/2\napp: PARSEC\nvault: 00\naddress: X\n";

    #[test]
    fn algorand_raw_and_mx_signatures_verify_and_others_do_not() {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let addr = crate::chain_algo::keys::address_from_bytes(&sk.verifying_key().to_bytes());
        let raw = sk.sign(MSG).to_bytes();
        let mx = sk.sign(&[b"MX".as_slice(), MSG].concat()).to_bytes();
        assert!(verify("algorand", &addr, MSG, &raw).is_ok());
        assert!(verify("algorand", &addr, MSG, &mx).is_ok());
        assert!(verify("algorand", &addr, b"another message", &raw).is_err());
        let other = SigningKey::from_bytes(&[8u8; 32]);
        let other_addr = crate::chain_algo::keys::address_from_bytes(&other.verifying_key().to_bytes());
        assert!(verify("algorand", &other_addr, MSG, &raw).is_err());
    }

    #[test]
    fn solana_signatures_verify_against_the_base58_address() {
        let sk = SigningKey::from_bytes(&[9u8; 32]);
        let addr = bitcoin::base58::encode(&sk.verifying_key().to_bytes());
        assert!(verify("solana", &addr, MSG, &sk.sign(MSG).to_bytes()).is_ok());
        assert!(verify("solana", &addr, MSG, &[0u8; 64]).is_err());
    }

    #[test]
    fn evm_personal_sign_recovers_to_the_address() {
        let secret = [0x11u8; 32];
        let addr = crate::chain_evm::sign::address_from_secret(&secret).unwrap();
        let mut prefixed = format!("\x19Ethereum Signed Message:\n{}", MSG.len()).into_bytes();
        prefixed.extend_from_slice(MSG);
        let hash = Keccak256::digest(&prefixed);
        let sk = k256::ecdsa::SigningKey::from_bytes((&secret).into()).unwrap();
        let (sig, rid) = sk.sign_prehash_recoverable(&hash).unwrap();
        let mut bytes = sig.to_bytes().to_vec();
        bytes.push(rid.to_byte() + 27);
        assert!(verify("ethereum", &addr, MSG, &bytes).is_ok());
        assert!(verify("ethereum", "0x0000000000000000000000000000000000000001", MSG, &bytes).is_err());
    }
}
