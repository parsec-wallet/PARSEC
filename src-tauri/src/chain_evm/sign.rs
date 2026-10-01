//! EIP-1559 (type-2) transaction signing with k256 secp256k1.
//!
//! sighash  = keccak256(0x02 || rlp([chainId, nonce, maxPrio, maxFee, gas, to, value, data, accessList]))
//! envelope = 0x02 || rlp([... the 9 ..., yParity, r, s]);  txHash = keccak256(envelope)

use k256::ecdsa::{RecoveryId, Signature, SigningKey};
use sha3::{Digest, Keccak256};

use super::{rlp, EvmTxRequest, SignedEvmTx};

/// keccak256 helper.
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    Keccak256::digest(data).into()
}

/// Parse a 32-byte secret into a signing key (rejects zero / out-of-range scalars).
pub fn signing_key(secret: &[u8; 32]) -> Result<SigningKey, String> {
    SigningKey::from_slice(secret).map_err(|e| format!("invalid private key: {e}"))
}

/// Lowercase 0x address: last 20 bytes of keccak256(uncompressed pubkey without 0x04).
pub fn address_from_secret(secret: &[u8; 32]) -> Result<String, String> {
    let key = signing_key(secret)?;
    let point = key.verifying_key().to_encoded_point(false);
    let digest = keccak256(&point.as_bytes()[1..]);
    Ok(format!("0x{}", hex::encode(&digest[12..])))
}

fn parse_u128(s: &str, field: &str) -> Result<u128, String> {
    s.trim()
        .parse::<u128>()
        .map_err(|_| format!("{field}: expected a decimal integer, got {s:?}"))
}

fn parse_hex(s: &str, field: &str) -> Result<Vec<u8>, String> {
    let t = s.trim();
    let t = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")).unwrap_or(t);
    hex::decode(t).map_err(|e| format!("{field}: invalid hex ({e})"))
}

/// The 9 unsigned fields, RLP-encoded in EIP-1559 order.
fn unsigned_fields(tx: &EvmTxRequest) -> Result<Vec<Vec<u8>>, String> {
    let to = parse_hex(&tx.to, "to")?;
    if !(to.is_empty() || to.len() == 20) {
        return Err(format!("to: expected 20 bytes, got {}", to.len()));
    }
    Ok(vec![
        rlp::encode_uint(tx.chain_id as u128),
        rlp::encode_uint(tx.nonce as u128),
        rlp::encode_uint(parse_u128(&tx.max_priority_fee_per_gas, "max_priority_fee_per_gas")?),
        rlp::encode_uint(parse_u128(&tx.max_fee_per_gas, "max_fee_per_gas")?),
        rlp::encode_uint(tx.gas_limit as u128),
        rlp::encode_bytes(&to),
        rlp::encode_uint(parse_u128(&tx.value, "value")?),
        rlp::encode_bytes(&parse_hex(&tx.data, "data")?),
        rlp::encode_list(&[]), // accessList
    ])
}

/// keccak256(0x02 || rlp(unsigned fields)) — what gets signed.
pub fn signing_hash(tx: &EvmTxRequest) -> Result<[u8; 32], String> {
    let mut payload = vec![0x02u8];
    payload.extend(rlp::encode_list(&unsigned_fields(tx)?));
    Ok(keccak256(&payload))
}

/// Sign and return (envelope, sighash, low-s signature, y_parity).
fn sign_inner(
    secret: &[u8; 32],
    tx: &EvmTxRequest,
) -> Result<(SignedEvmTx, [u8; 32], Signature, RecoveryId), String> {
    let key = signing_key(secret)?;
    let mut fields = unsigned_fields(tx)?;
    let mut payload = vec![0x02u8];
    payload.extend(rlp::encode_list(&fields));
    let sighash = keccak256(&payload);

    let (mut sig, mut recid) = key
        .sign_prehash_recoverable(&sighash)
        .map_err(|e| format!("signing failed: {e}"))?;
    // k256 already emits low-s; enforce it anyway (flipping parity if it ever normalizes).
    if let Some(low) = sig.normalize_s() {
        sig = low;
        recid = RecoveryId::new(!recid.is_y_odd(), recid.is_x_reduced());
    }

    fields.push(rlp::encode_uint(recid.to_byte() as u128));
    fields.push(rlp::encode_uint_be(&sig.r().to_bytes()));
    fields.push(rlp::encode_uint_be(&sig.s().to_bytes()));

    let mut envelope = vec![0x02u8];
    envelope.extend(rlp::encode_list(&fields));
    let signed = SignedEvmTx {
        tx_hash: format!("0x{}", hex::encode(keccak256(&envelope))),
        raw_hex: format!("0x{}", hex::encode(&envelope)),
    };
    Ok((signed, sighash, sig, recid))
}

/// Sign an EIP-1559 transaction with a raw 32-byte secp256k1 secret.
pub fn sign_eip1559(secret: &[u8; 32], tx: &EvmTxRequest) -> Result<SignedEvmTx, String> {
    sign_inner(secret, tx).map(|(signed, _, _, _)| signed)
}

#[cfg(test)]
mod tests {
    /// cp4096 commitment V, wallet-side rule: *"never persist or pass a signature
    /// as a `(v, r, s)` tuple. Signature surfaces stay `bytes`."*
    ///
    /// `(v, r, s)` exists only inside `sign_inner`, where it is consumed to build
    /// the RLP envelope. What crosses the IPC boundary is the signed transaction
    /// and its hash. This test pins that: if anyone adds `v`, `r`, `s` or
    /// `y_parity` to the returned struct, it fails.
    #[test]
    fn signed_tx_crosses_the_boundary_as_bytes_not_a_v_r_s_tuple() {
        let tx = super::super::SignedEvmTx {
            raw_hex: "0x02f8".to_string(),
            tx_hash: "0xabcd".to_string(),
        };
        let json = serde_json::to_value(&tx).unwrap();
        let obj = json.as_object().expect("SignedEvmTx must serialise to an object");

        let mut keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["raw_hex", "tx_hash"],
            "the EVM signing surface gained a field; signatures must stay bytes-shaped"
        );

        for forbidden in ["v", "r", "s", "y_parity", "recovery_id", "recid"] {
            assert!(
                !obj.contains_key(forbidden),
                "signature component {forbidden:?} must not cross the boundary"
            );
        }
    }

    use super::*;
    use k256::ecdsa::VerifyingKey;

    const KEY_HEX: &str = "4646464646464646464646464646464646464646464646464646464646464646";
    const ADDR: &str = "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f";

    fn secret() -> [u8; 32] {
        hex::decode(KEY_HEX).unwrap().try_into().unwrap()
    }

    fn base_tx() -> EvmTxRequest {
        EvmTxRequest {
            chain_id: 8453,
            nonce: 0,
            max_priority_fee_per_gas: "1000000000".into(),
            max_fee_per_gas: "2000000000".into(),
            gas_limit: 21000,
            to: "0x0000000000000000000000000000000000000001".into(),
            value: "1".into(),
            data: "".into(),
        }
    }

    #[test]
    fn address_matches_known_vector() {
        assert_eq!(address_from_secret(&secret()).unwrap(), ADDR);
    }

    // Independent reference produced with eth_account (Python) for the same key + tx.
    const SIGHASH: &str = "0b0e7a09e6d17c538e40625925c9d9133c9e49e78d4e2e7a6edd0e0344312947";
    const RAW: &str = "0x02f86c82210580843b9aca0084773594008252089400000000000000000000000000000000000000010180c080a058d418cd308d99989ce1625d839a3ac32d47fc33f6287afce287f2c9481292dba05d2552dba9df372c1efb1680f08d399509f45e223c70d88fb9c9c85d06bb6ced";
    const TX_HASH: &str = "0x6484476ec458a115ae494d476bd927e8e322e2f6b335bcd63eeaa73de6202e42";

    #[test]
    fn signing_hash_is_pinned() {
        let h = hex::encode(signing_hash(&base_tx()).unwrap());
        println!("chain_evm signing_hash = 0x{h}");
        assert_eq!(h, SIGHASH);
    }

    #[test]
    fn raw_tx_matches_eth_account_reference() {
        let signed = sign_eip1559(&secret(), &base_tx()).unwrap();
        assert_eq!(signed.raw_hex, RAW);
        assert_eq!(signed.tx_hash, TX_HASH);
    }

    #[test]
    fn signer_recovers_and_envelope_is_consistent() {
        let (signed, sighash, sig, recid) = sign_inner(&secret(), &base_tx()).unwrap();
        assert!(signed.raw_hex.starts_with("0x02"));
        assert!(recid.to_byte() <= 1);
        assert!(sig.normalize_s().is_none(), "s must be low");

        let raw = hex::decode(&signed.raw_hex[2..]).unwrap();
        assert_eq!(signed.tx_hash, format!("0x{}", hex::encode(keccak256(&raw))));

        let vk = VerifyingKey::recover_from_prehash(&sighash, &sig, recid).unwrap();
        let point = vk.to_encoded_point(false);
        let addr = format!("0x{}", hex::encode(&keccak256(&point.as_bytes()[1..])[12..]));
        assert_eq!(addr, ADDR);

        // Deterministic (RFC 6979): signing twice yields identical bytes.
        let again = sign_eip1559(&secret(), &base_tx()).unwrap();
        assert_eq!(again.raw_hex, signed.raw_hex);
    }

    #[test]
    fn rejects_bad_inputs() {
        let mut tx = base_tx();
        tx.to = "0x1234".into();
        assert!(sign_eip1559(&secret(), &tx).is_err());
        let mut tx = base_tx();
        tx.value = "1e18".into();
        assert!(sign_eip1559(&secret(), &tx).is_err());
        assert!(address_from_secret(&[0u8; 32]).is_err());
    }

    #[test]
    fn large_value_and_calldata() {
        let mut tx = base_tx();
        tx.value = "340000000000000000000000000000000000000".into(); // 3.4e38 wei fits u128
        tx.data = format!("0x{}", "ab".repeat(100));
        let signed = sign_eip1559(&secret(), &tx).unwrap();
        assert!(signed.raw_hex.starts_with("0x02f8")); // long list prefix
    }
}
