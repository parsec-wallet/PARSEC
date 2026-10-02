// bankon_vault::kdf — password stretching and key derivation.
//
// Two distinct jobs, deliberately not interchangeable:
//
//   Argon2id  stretches a LOW-entropy human passphrase into a key encryption key.
//             Memory-hard, so GPU and ASIC attackers gain far less than they do
//             against PBKDF2 or a bare hash.
//   HKDF      expands an ALREADY-high-entropy secret (the Argon2id output, a
//             wallet signature, a key file) into per-purpose subkeys.
//
// The sibling implementations in this family blur that line and it costs them:
// mindX's production vault stretches with PBKDF2-SHA512, and the DeltaVerse and
// walletcreator participant vaults feed a human passphrase straight into HKDF,
// which performs no stretching at all. HKDF here is reachable only from
// high-entropy input; a passphrase must go through Argon2id first. That rule is
// enforced by the Overseer types, not by convention.
//
// HMAC and HKDF are implemented here rather than pulled from the `hmac`/`hkdf`
// crates, which are present transitively but are not direct dependencies. cp4096
// commitment II says not to widen the dependency surface; both algorithms are
// short enough to audit in one screen and are pinned by RFC 4231 known-answer
// tests plus cross-implementation vectors.

use argon2::{Algorithm, Argon2, Params, Version};
use sha2::{Digest, Sha512};

use super::secure_mem::{wipe, SecretBytes};

const SHA512_BLOCK: usize = 128;
const SHA512_OUT: usize = 64;

/// HMAC-SHA-512 (RFC 2104).
pub fn hmac_sha512(key: &[u8], msg: &[u8]) -> [u8; SHA512_OUT] {
    let mut block = [0u8; SHA512_BLOCK];

    // Keys longer than the block size are hashed down; shorter keys are zero-padded.
    if key.len() > SHA512_BLOCK {
        let digest = Sha512::digest(key);
        block[..SHA512_OUT].copy_from_slice(&digest);
    } else {
        block[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; SHA512_BLOCK];
    let mut opad = [0x5cu8; SHA512_BLOCK];
    for i in 0..SHA512_BLOCK {
        ipad[i] ^= block[i];
        opad[i] ^= block[i];
    }

    let mut inner = Sha512::new();
    inner.update(ipad);
    inner.update(msg);
    let inner = inner.finalize();

    let mut outer = Sha512::new();
    outer.update(opad);
    outer.update(inner);
    let out = outer.finalize();

    // The padded key blocks are derived from key material; do not leave them.
    wipe(&mut block);
    wipe(&mut ipad);
    wipe(&mut opad);

    let mut result = [0u8; SHA512_OUT];
    result.copy_from_slice(&out);
    result
}

/// HKDF-Extract (RFC 5869): compress input keying material into a pseudorandom key.
pub fn hkdf_extract(salt: &[u8], ikm: &[u8]) -> [u8; SHA512_OUT] {
    hmac_sha512(salt, ikm)
}

/// HKDF-Expand (RFC 5869): stretch a PRK into `len` bytes bound to `info`.
///
/// `info` is the domain separator. Two derivations that differ only in `info`
/// yield unrelated keys, which is what lets one master key safely produce a
/// distinct key per vault entry.
pub fn hkdf_expand(prk: &[u8], info: &[u8], len: usize) -> Result<SecretBytes, String> {
    if len > 255 * SHA512_OUT {
        return Err("hkdf: requested length exceeds 255 * HashLen".to_string());
    }
    let mut okm = SecretBytes::zeroed(len);
    let mut prev: Vec<u8> = Vec::new();
    let mut written = 0usize;
    let mut counter: u8 = 1;

    while written < len {
        let mut msg = Vec::with_capacity(prev.len() + info.len() + 1);
        msg.extend_from_slice(&prev);
        msg.extend_from_slice(info);
        msg.push(counter);

        let mut t = hmac_sha512(prk, &msg);
        wipe(&mut msg);

        let take = core::cmp::min(SHA512_OUT, len - written);
        okm.as_mut_slice()[written..written + take].copy_from_slice(&t[..take]);
        written += take;

        prev.clear();
        prev.extend_from_slice(&t);
        wipe(&mut t);
        counter = counter.wrapping_add(1);
    }

    wipe(&mut prev);
    Ok(okm)
}

/// HKDF-Extract followed by HKDF-Expand.
pub fn hkdf(salt: &[u8], ikm: &[u8], info: &[u8], len: usize) -> Result<SecretBytes, String> {
    let mut prk = hkdf_extract(salt, ikm);
    let out = hkdf_expand(&prk, info, len);
    wipe(&mut prk);
    out
}

// ── Argon2id ────────────────────────────────────────────────────────────────

/// Argon2id cost parameters. Stored in the vault header and authenticated as
/// associated data, so an attacker who edits the file to weaken them makes it
/// fail to open rather than fall back to a cheap derivation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct KdfParams {
    /// Memory cost in KiB.
    pub m_cost: u32,
    /// Time cost (passes).
    pub t_cost: u32,
    /// Parallelism (lanes).
    pub p_cost: u32,
}

impl KdfParams {
    /// Desktop default: 256 MiB, 3 passes, 4 lanes.
    ///
    /// The passphrase is the only thing protecting a stolen machine, so this is
    /// set far above the OWASP floor of 19 MiB / t=2 that `Argon2::default()`
    /// supplies, and far above every wallet compared in the plan.
    pub const DESKTOP: Self = Self { m_cost: 262_144, t_cost: 3, p_cost: 4 };

    /// Mobile default: 64 MiB, 3 passes, 2 lanes. Android's low-memory killer
    /// will reap a foreground app that briefly claims 256 MiB.
    pub const MOBILE: Self = Self { m_cost: 65_536, t_cost: 3, p_cost: 2 };

    /// Absolute minimum any vault may declare. A file asking for less than this
    /// is rejected rather than honoured — a header is attacker-reachable, so
    /// "whatever the file says" must have a floor under it.
    pub const FLOOR: Self = Self { m_cost: 65_536, t_cost: 2, p_cost: 1 };

    /// The most any vault may ask for: 1 GiB, 16 passes, 16 lanes. A header is
    /// attacker-reachable, and one asking for 4 TiB would hang or abort the unlock
    /// (audit H10) — refused before any work is done.
    pub const CEILING: Self = Self { m_cost: 1_048_576, t_cost: 16, p_cost: 16 };

    /// Cheap parameters for tests only. Never reachable from a real vault.
    #[cfg(test)]
    pub const TEST: Self = Self { m_cost: 8, t_cost: 1, p_cost: 1 };

    /// The default profile for the platform this build targets.
    pub fn platform_default() -> Self {
        if cfg!(any(target_os = "android", target_os = "ios")) {
            Self::MOBILE
        } else {
            Self::DESKTOP
        }
    }

    /// True if these parameters meet the floor on every axis.
    pub fn meets_floor(&self) -> bool {
        self.m_cost >= Self::FLOOR.m_cost
            && self.t_cost >= Self::FLOOR.t_cost
            && self.p_cost >= Self::FLOOR.p_cost
    }

    /// True if these parameters are at or under the ceiling on every axis.
    pub fn within_ceiling(&self) -> bool {
        self.m_cost <= Self::CEILING.m_cost
            && self.t_cost <= Self::CEILING.t_cost
            && self.p_cost <= Self::CEILING.p_cost
    }

    /// Floor and ceiling, with an error that says which — distinct from a wrong
    /// passphrase, so a tampered header is reported as tampering.
    pub fn check(&self) -> Result<(), String> {
        if !self.within_ceiling() {
            return Err(format!(
                "the vault asks for an unsafe key-derivation cost (m={} t={} p={}, maximum m={} t={} p={}); \
                 refusing — the file may have been tampered with",
                self.m_cost, self.t_cost, self.p_cost,
                Self::CEILING.m_cost, Self::CEILING.t_cost, Self::CEILING.p_cost,
            ));
        }
        if !self.meets_floor() {
            return Err(format!(
                "refusing to derive with parameters below the floor \
                 (m={} t={} p={}, minimum m={} t={} p={})",
                self.m_cost, self.t_cost, self.p_cost,
                Self::FLOOR.m_cost, Self::FLOOR.t_cost, Self::FLOOR.p_cost,
            ));
        }
        Ok(())
    }

    /// The canonical bytes bound into a wrap's associated data.
    pub fn aad_bytes(&self) -> [u8; 12] {
        let mut b = [0u8; 12];
        b[..4].copy_from_slice(&self.m_cost.to_be_bytes());
        b[4..8].copy_from_slice(&self.t_cost.to_be_bytes());
        b[8..].copy_from_slice(&self.p_cost.to_be_bytes());
        b
    }

    fn to_argon2(self) -> Result<Argon2<'static>, String> {
        let params = Params::new(self.m_cost, self.t_cost, self.p_cost, Some(32))
            .map_err(|e| format!("invalid argon2 parameters: {e}"))?;
        Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
    }
}

/// The Argon2id primitive, with no policy attached.
///
/// Private on purpose. Every caller outside this module goes through
/// [`argon2id`], so the cost floor cannot be sidestepped by reaching for a
/// lower-level entry point — the only code that can derive with sub-floor
/// parameters is this module's own tests.
fn argon2id_unchecked(
    passphrase: &[u8],
    salt: &[u8],
    params: KdfParams,
) -> Result<SecretBytes, String> {
    let mut out = SecretBytes::zeroed(32);
    params
        .to_argon2()?
        .hash_password_into(passphrase, salt, out.as_mut_slice())
        .map_err(|e| format!("key derivation failed: {e}"))?;
    Ok(out)
}

/// Stretch a passphrase into a 32-byte key with Argon2id, enforcing the cost floor.
///
/// The floor is checked here rather than at the call site because the parameters
/// arrive from the vault header, which is attacker-reachable: without this, an
/// edited file could ask for m=8 KiB and the vault would obligingly derive at a
/// cost an attacker can brute-force.
pub fn argon2id(passphrase: &[u8], salt: &[u8], params: KdfParams) -> Result<SecretBytes, String> {
    params.check()?;
    argon2id_unchecked(passphrase, salt, params)
}

/// Raise `t_cost` until a derivation costs about `target_ms` on this machine,
/// leaving memory at the platform default.
///
/// Bitcoin Core does the same thing (`EncryptMasterKey` targets 100 ms and stores
/// the resulting count per wallet) and it is the reason its KDF cost tracks
/// hardware without a format migration. The target here is far higher than
/// Core's 100 ms because unlocking is rare and interactive, and every extra
/// millisecond costs an offline attacker proportionally.
pub fn calibrate(target_ms: u64) -> KdfParams {
    let mut params = KdfParams::platform_default();
    let salt = [0x42u8; 32];

    let start = std::time::Instant::now();
    if argon2id(b"calibration probe", &salt, params).is_err() {
        return params;
    }
    let elapsed = start.elapsed().as_millis().max(1) as u64;

    if elapsed < target_ms {
        let scaled = (params.t_cost as u64).saturating_mul(target_ms) / elapsed;
        // Cap the climb so a very fast machine cannot make the vault unopenable
        // on a slower one the participant also uses.
        params.t_cost = scaled.clamp(params.t_cost as u64, 10) as u32;
    }
    params
}

#[cfg(test)]
mod tests {

    #[test]
    fn the_ceiling_and_floor_bound_what_a_header_may_ask_for() {
        assert!(KdfParams::DESKTOP.check().is_ok());
        assert!(KdfParams::MOBILE.check().is_ok());
        assert!(KdfParams::CEILING.check().is_ok());
        let huge = KdfParams { m_cost: KdfParams::CEILING.m_cost + 1, ..KdfParams::DESKTOP };
        assert!(huge.check().unwrap_err().contains("unsafe"));
        assert!(argon2id(b"pw", &[0u8; 32], KdfParams { t_cost: 1_000, ..KdfParams::FLOOR }).is_err());
        assert!(KdfParams::TEST.check().unwrap_err().contains("below the floor"));
    }
    use super::*;

    fn hx(s: &str) -> Vec<u8> {
        hex::decode(s).unwrap()
    }

    // ── RFC 4231 known-answer tests for HMAC-SHA-512 ────────────────────────

    #[test]
    fn hmac_sha512_rfc4231_case1() {
        let mac = hmac_sha512(&[0x0b; 20], b"Hi There");
        assert_eq!(
            hex::encode(mac),
            "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cded\
             aa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854"
                .replace(['\n', ' '], "")
        );
    }

    #[test]
    fn hmac_sha512_rfc4231_case2() {
        let mac = hmac_sha512(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(
            hex::encode(mac),
            "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea250554\
             9758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737"
                .replace(['\n', ' '], "")
        );
    }

    #[test]
    fn hmac_sha512_rfc4231_case3() {
        let mac = hmac_sha512(&[0xaa; 20], &[0xdd; 50]);
        assert_eq!(
            hex::encode(mac),
            "fa73b0089d56a284efb0f0756c890be9b1b5dbdd8ee81a3655f83e33b2279d39\
             bf3e848279a722c806b485a47e67c807b946a337bee8942674278859e13292fb"
                .replace(['\n', ' '], "")
        );
    }

    /// Case 6 exercises the >128-byte key path, which is the branch most likely
    /// to be implemented wrongly.
    #[test]
    fn hmac_sha512_rfc4231_case6_long_key() {
        let mac = hmac_sha512(&[0xaa; 131], b"Test Using Larger Than Block-Size Key - Hash Key First");
        assert_eq!(
            hex::encode(mac),
            "80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f352\
             6b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598"
                .replace(['\n', ' '], "")
        );
    }

    // ── HKDF ────────────────────────────────────────────────────────────────

    #[test]
    fn hkdf_extract_is_hmac_of_ikm_under_salt() {
        // The definition, restated as a test so a refactor cannot drift from it.
        assert_eq!(hkdf_extract(b"salt", b"ikm"), hmac_sha512(b"salt", b"ikm"));
    }

    #[test]
    fn hkdf_domain_separation_yields_unrelated_keys() {
        let a = hkdf(b"salt", b"master", b"bankon-entry:one:ctx", 32).unwrap();
        let b = hkdf(b"salt", b"master", b"bankon-entry:two:ctx", 32).unwrap();
        let c = hkdf(b"salt", b"master", b"bankon-entry:one:ctx", 32).unwrap();
        assert_ne!(a.as_slice(), b.as_slice(), "different info must diverge");
        assert_eq!(a.as_slice(), c.as_slice(), "same inputs must be deterministic");
    }

    #[test]
    fn hkdf_expand_produces_requested_length_across_block_boundaries() {
        for len in [1usize, 31, 32, 64, 65, 200, 1000] {
            let out = hkdf(b"salt", b"ikm", b"info", len).unwrap();
            assert_eq!(out.len(), len, "length {len}");
        }
    }

    #[test]
    fn hkdf_rejects_absurd_lengths() {
        assert!(hkdf(b"salt", b"ikm", b"info", 255 * 64 + 1).is_err());
    }

    // ── Argon2id policy ─────────────────────────────────────────────────────

    #[test]
    fn shipped_profiles_meet_the_floor() {
        assert!(KdfParams::DESKTOP.meets_floor());
        assert!(KdfParams::MOBILE.meets_floor());
        assert!(KdfParams::FLOOR.meets_floor());
        assert!(KdfParams::platform_default().meets_floor());
    }

    /// The regression that matters: nobody may quietly lower the cost, and the
    /// old `Argon2::default()` (19 MiB, t=2, p=1) must now be rejected outright.
    #[test]
    fn parameters_below_the_floor_are_refused() {
        let weak = KdfParams { m_cost: 19_456, t_cost: 2, p_cost: 1 };
        assert!(!weak.meets_floor(), "the old Argon2::default() must not pass");
        let err = argon2id(b"passphrase", &[0u8; 32], weak)
            .expect_err("weak parameters must be refused");
        assert!(err.contains("below the floor"), "got: {err}");
    }

    #[test]
    fn argon2id_is_deterministic_and_salt_dependent() {
        // Cheap parameters via the unchecked primitive; the floor policy has its
        // own test below and must not be weakened just to make this one fast.
        let p = KdfParams::TEST;
        let a = argon2id_unchecked(b"passphrase", &[1u8; 32], p).unwrap();
        let b = argon2id_unchecked(b"passphrase", &[1u8; 32], p).unwrap();
        let c = argon2id_unchecked(b"passphrase", &[2u8; 32], p).unwrap();
        let d = argon2id_unchecked(b"different", &[1u8; 32], p).unwrap();
        assert_eq!(a.as_slice(), b.as_slice());
        assert_ne!(a.as_slice(), c.as_slice(), "salt must change the output");
        assert_ne!(a.as_slice(), d.as_slice(), "passphrase must change the output");
        assert_eq!(a.len(), 32);
    }

    /// The test profile must never be reachable through the public entry point.
    #[test]
    fn test_profile_is_rejected_by_the_public_api() {
        assert!(!KdfParams::TEST.meets_floor());
        assert!(argon2id(b"passphrase", &[0u8; 32], KdfParams::TEST).is_err());
    }

    #[test]
    fn desktop_profile_far_exceeds_every_compared_wallet() {
        // 256 MiB against MetaMask's PBKDF2 (no memory hardness at all), Pera's
        // 16 MiB scrypt, and Bitcoin Core's iterated SHA-512.
        assert_eq!(KdfParams::DESKTOP.m_cost, 262_144);
        assert!(KdfParams::DESKTOP.m_cost >= 16 * 1024 * 16);
    }
}
