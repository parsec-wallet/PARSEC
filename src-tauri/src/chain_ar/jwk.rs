// chain_ar::jwk — Arweave's RSA JWK encoding.
//
// Arweave keys are JSON Web Keys with base64url-unpadded components. `n` and `e`
// are public; `d`, `p`, `q`, `dp`, `dq`, `qi` are the private key and must never
// leave Rust except through an explicit export.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use rsa::traits::{PrivateKeyParts, PublicKeyParts};
use rsa::{BigUint, RsaPrivateKey};
use serde::{Deserialize, Serialize};

/// An Arweave JWK. Field names and order follow the JWK spec so the output is
/// interchangeable with `arweave-js` and the Arweave CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArweaveJwk {
    pub kty: String,
    pub n: String,
    pub e: String,
    pub d: String,
    pub p: String,
    pub q: String,
    pub dp: String,
    pub dq: String,
    pub qi: String,
}

fn enc(v: &BigUint) -> String {
    B64URL.encode(v.to_bytes_be())
}

fn dec(s: &str, field: &str) -> Result<BigUint, String> {
    let raw = B64URL
        .decode(s.as_bytes())
        .map_err(|_| format!("JWK field {field:?} is not valid base64url"))?;
    Ok(BigUint::from_bytes_be(&raw))
}

pub fn from_private_key(key: &RsaPrivateKey) -> Result<ArweaveJwk, String> {
    let primes = key.primes();
    if primes.len() != 2 {
        return Err("only two-prime RSA keys are supported".to_string());
    }
    let (p, q) = (&primes[0], &primes[1]);
    let dp = key.dp().ok_or("key is missing dP")?;
    let dq = key.dq().ok_or("key is missing dQ")?;
    let qi = key.qinv().ok_or("key is missing qInv")?;

    Ok(ArweaveJwk {
        kty: "RSA".to_string(),
        n: enc(key.n()),
        e: enc(key.e()),
        d: enc(key.d()),
        p: enc(p),
        q: enc(q),
        dp: enc(dp),
        dq: enc(dq),
        // qInv is a signed value in the `rsa` crate; Arweave expects it unsigned.
        qi: B64URL.encode(qi.to_biguint().ok_or("qInv is negative")?.to_bytes_be()),
    })
}

pub fn to_private_key(jwk: &ArweaveJwk) -> Result<RsaPrivateKey, String> {
    if jwk.kty != "RSA" {
        return Err(format!("expected an RSA JWK, got kty={:?}", jwk.kty));
    }
    let n = dec(&jwk.n, "n")?;
    let e = dec(&jwk.e, "e")?;
    let d = dec(&jwk.d, "d")?;
    let p = dec(&jwk.p, "p")?;
    let q = dec(&jwk.q, "q")?;

    // Rebuild from the primes and let the crate recompute the CRT values, so a
    // JWK carrying inconsistent dp/dq/qi cannot produce a key that signs wrongly.
    let key = RsaPrivateKey::from_components(n, e, d, vec![p, q])
        .map_err(|e| format!("invalid RSA JWK: {e}"))?;
    key.validate().map_err(|e| format!("RSA key failed validation: {e}"))?;
    Ok(key)
}

/// The public "owner" field: the modulus, base64url.
pub fn owner(jwk: &ArweaveJwk) -> &str {
    &jwk.n
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    /// 2048 bits here purely for test speed; production keys are 4096.
    fn small_key() -> RsaPrivateKey {
        RsaPrivateKey::new(&mut OsRng, 2048).unwrap()
    }

    #[test]
    fn jwk_round_trips_through_a_private_key() {
        let key = small_key();
        let jwk = from_private_key(&key).unwrap();
        assert_eq!(jwk.kty, "RSA");
        let back = to_private_key(&jwk).unwrap();
        assert_eq!(back.n(), key.n());
        assert_eq!(back.d(), key.d());
        assert_eq!(from_private_key(&back).unwrap().n, jwk.n);
    }

    #[test]
    fn jwk_fields_are_unpadded_base64url() {
        let jwk = from_private_key(&small_key()).unwrap();
        for (name, v) in [
            ("n", &jwk.n), ("e", &jwk.e), ("d", &jwk.d), ("p", &jwk.p),
            ("q", &jwk.q), ("dp", &jwk.dp), ("dq", &jwk.dq), ("qi", &jwk.qi),
        ] {
            assert!(!v.contains('='), "{name} must be unpadded");
            assert!(!v.contains('+') && !v.contains('/'), "{name} must be url-safe");
            assert!(!v.is_empty(), "{name} must be present");
        }
    }

    #[test]
    fn serialises_to_the_json_arweave_tools_expect() {
        let jwk = from_private_key(&small_key()).unwrap();
        let json = serde_json::to_value(&jwk).unwrap();
        let obj = json.as_object().unwrap();
        for f in ["kty", "n", "e", "d", "p", "q", "dp", "dq", "qi"] {
            assert!(obj.contains_key(f), "JWK must carry {f}");
        }
        assert_eq!(obj["kty"], "RSA");
    }

    #[test]
    fn rejects_a_non_rsa_jwk() {
        let mut jwk = from_private_key(&small_key()).unwrap();
        jwk.kty = "EC".to_string();
        assert!(to_private_key(&jwk).unwrap_err().contains("expected an RSA JWK"));
    }

    #[test]
    fn rejects_a_jwk_with_a_corrupted_prime() {
        let mut jwk = from_private_key(&small_key()).unwrap();
        jwk.p = B64URL.encode(BigUint::from(7u32).to_bytes_be());
        assert!(to_private_key(&jwk).is_err(), "inconsistent primes must be refused");
    }
}
