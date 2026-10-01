// bankon_vault::overseer — pluggable custody.
//
// Every way of opening a vault reduces to one question: produce the key that
// unwraps the DEK. That factoring is lifted from mindX's production vault, where
// a `VaultOverseer` turns machine key-files, human EIP-191 signatures and DAO
// custody into a single HKDF call — it is the best structural idea in that
// codebase and it is why adding a custody mode costs almost no crypto code.
//
// Two things are tightened here relative to the reference:
//
//   1. A passphrase MUST pass through Argon2id first. The reference derives the
//      master key from a passphrase with bare HKDF, which performs no stretching
//      at all — fine for a 65-byte signature, catastrophic for a human secret.
//      The type system enforces the split: `needs_stretching()` decides, and the
//      passphrase overseer is the only one that can reach the memory-hard path.
//   2. Each custody kind derives under its own domain prefix, so a credential
//      accepted for one kind can never be replayed as another.

use super::format::CustodyKind;
use super::kdf::{self, KdfParams};
use super::secure_mem::SecretBytes;

/// The message a participant signs to bind a vault to their wallet key.
///
/// SECURITY: a signature over this message is a bearer credential for the vault.
/// Anyone who can persuade the participant to sign this exact string can derive
/// the KEK, so it must never be reachable from a generic dApp signing path —
/// `parsec_connect` blocks it explicitly. The per-vault salt is mixed in at
/// derivation time so the same wallet key yields different vault keys for
/// different vaults.
pub const BINDING_MESSAGE: &str = "BANKON-VAULT-KEY-BINDING/v1";

const INFO_PASSPHRASE: &[u8] = b"bankon-overseer-passphrase-v1";
const INFO_WALLET: &[u8] = b"bankon-overseer-wallet-v1:";
const INFO_KEYFILE: &[u8] = b"bankon-overseer-keyfile-v1";

/// Length at which a passphrase is considered strong.
///
/// The passphrase is the only thing protecting a stolen machine, and it is paired
/// here with a 256 MiB Argon2id cost that no compared wallet approaches. But the
/// participant chooses: length is advisory, surfaced through [`assess`], never
/// enforced. Sovereignty over your own vault includes the right to make it weaker
/// than we would — our job is to make the consequence legible, not to refuse.
pub const STRONG_PASSPHRASE_LEN: usize = 12;

/// At or below this length a passphrase is flagged red.
pub const WEAK_PASSPHRASE_LEN: usize = 6;

/// Produces the key-encryption key that unwraps a vault's DEK.
pub trait Overseer {
    fn kind(&self) -> CustodyKind;
    fn label(&self) -> &str;

    /// KDF parameters this custodian needs recorded in its wrap, if any.
    fn kdf_params(&self) -> Option<KdfParams> {
        None
    }

    /// Derive the KEK. `salt` is this custodian's own salt from its wrap.
    fn kek(&self, salt: &[u8], params: Option<KdfParams>) -> Result<SecretBytes, String>;
}

/// Passphrase custody: Argon2id, then HKDF for domain separation.
pub struct PassphraseOverseer {
    passphrase: SecretBytes,
    label: String,
    params: KdfParams,
}

impl PassphraseOverseer {
    /// Create a custodian for a NEW passphrase, enforcing policy.
    pub fn new(passphrase: &str, label: &str, params: KdfParams) -> Result<Self, String> {
        check_passphrase_policy(passphrase)?;
        Ok(Self {
            passphrase: SecretBytes::from_slice(passphrase.as_bytes()),
            label: label.to_string(),
            params,
        })
    }

    /// Create a custodian to OPEN an existing vault. No policy check: the vault
    /// may predate the current rules, and refusing to open it would lock the
    /// participant out of their own funds over a style rule.
    pub fn for_unlock(passphrase: &str) -> Self {
        Self {
            passphrase: SecretBytes::from_slice(passphrase.as_bytes()),
            label: String::new(),
            params: KdfParams::platform_default(),
        }
    }
}

impl Overseer for PassphraseOverseer {
    fn kind(&self) -> CustodyKind {
        CustodyKind::Passphrase
    }
    fn label(&self) -> &str {
        &self.label
    }
    fn kdf_params(&self) -> Option<KdfParams> {
        Some(self.params)
    }
    fn kek(&self, salt: &[u8], params: Option<KdfParams>) -> Result<SecretBytes, String> {
        // Parameters come from the wrap when opening an existing vault, and from
        // this custodian when creating one. `argon2id` enforces the floor either
        // way, so a header edited to ask for a cheap derivation is refused.
        let params = params.unwrap_or(self.params);
        let stretched = kdf::argon2id(self.passphrase.as_slice(), salt, params)?;
        kdf::hkdf(salt, stretched.as_slice(), INFO_PASSPHRASE, 32)
    }
}

/// Wallet-signature custody: the participant's signature over [`BINDING_MESSAGE`].
///
/// The signature is high-entropy, so HKDF alone is correct here — no stretching
/// is needed or useful.
pub struct SignatureOverseer {
    signature: SecretBytes,
    address: String,
    label: String,
}

impl SignatureOverseer {
    /// `signature` must come from a DETERMINISTIC scheme — Ed25519, or ECDSA with
    /// RFC-6979 nonces. A wallet that signs with a random `k` produces a different
    /// signature every time and would make the vault permanently unopenable, so
    /// callers must verify the scheme before binding.
    pub fn new(signature: &[u8], address: &str, label: &str) -> Result<Self, String> {
        if signature.len() < 32 {
            return Err(format!(
                "signature is {} bytes; refusing to derive a vault key from \
                 anything shorter than 32",
                signature.len()
            ));
        }
        Ok(Self {
            signature: SecretBytes::from_slice(signature),
            address: address.to_string(),
            label: label.to_string(),
        })
    }
}

impl Overseer for SignatureOverseer {
    fn kind(&self) -> CustodyKind {
        CustodyKind::WalletSignature
    }
    fn label(&self) -> &str {
        &self.label
    }
    fn kek(&self, salt: &[u8], _params: Option<KdfParams>) -> Result<SecretBytes, String> {
        // The address is inside the info string, so a signature bound to one
        // account cannot be replayed to open a vault bound to another.
        let mut info = Vec::from(INFO_WALLET);
        info.extend_from_slice(self.address.as_bytes());
        kdf::hkdf(salt, self.signature.as_slice(), &info, 32)
    }
}

/// Key-file custody: raw high-entropy bytes, typically on removable media.
pub struct KeyFileOverseer {
    raw: SecretBytes,
    label: String,
}

impl KeyFileOverseer {
    pub fn new(raw: &[u8], label: &str) -> Result<Self, String> {
        if raw.len() < 32 {
            return Err("key file must be at least 32 bytes of entropy".to_string());
        }
        Ok(Self {
            raw: SecretBytes::from_slice(raw),
            label: label.to_string(),
        })
    }
}

impl Overseer for KeyFileOverseer {
    fn kind(&self) -> CustodyKind {
        CustodyKind::KeyFile
    }
    fn label(&self) -> &str {
        &self.label
    }
    fn kek(&self, salt: &[u8], _params: Option<KdfParams>) -> Result<SecretBytes, String> {
        kdf::hkdf(salt, self.raw.as_slice(), INFO_KEYFILE, 32)
    }
}

/// How strong a passphrase is. Bands are by length, as specified by the operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Strength {
    /// 6 characters or fewer. Shown in red.
    Weak,
    /// 7 to 11 characters.
    Medium,
    /// 12 characters or more.
    Strong,
}

impl Strength {
    pub fn tag(&self) -> &'static str {
        match self {
            Self::Weak => "weak",
            Self::Medium => "medium",
            Self::Strong => "strong",
        }
    }
}

/// A passphrase assessment: the band, plus specific things worth telling the
/// participant. Advisory only — nothing here blocks a choice.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Assessment {
    pub strength: Strength,
    pub length: usize,
    /// Concrete, non-scolding notes. Empty when there is nothing to say.
    pub warnings: Vec<String>,
}

/// Assess a passphrase.
///
/// The band is a pure function of length, so the meter never moves for a reason
/// the participant cannot see. Everything else is reported as a separate warning
/// rather than silently dragging the score around.
pub fn assess(passphrase: &str) -> Assessment {
    let length = passphrase.chars().count();
    let strength = if length >= STRONG_PASSPHRASE_LEN {
        Strength::Strong
    } else if length > WEAK_PASSPHRASE_LEN {
        Strength::Medium
    } else {
        Strength::Weak
    };

    let mut warnings = Vec::new();
    if length == 0 {
        warnings.push("Empty — this vault would have no protection at all.".to_string());
        return Assessment { strength, length, warnings };
    }

    let lowered = passphrase.to_lowercase();
    const COMMON: &[&str] = &[
        "password", "passphrase", "123456", "12345678", "123456789012",
        "qwerty", "qwertyuiop", "letmein", "correct horse battery staple",
        "111111", "111111111111", "abcdefghijkl", "bankonvault",
        "parsecwallet", "000000", "000000000000", "aaaaaaaaaaaa", "iloveyou",
        "admin", "welcome", "monkey", "dragon",
    ];
    let squashed = lowered.replace([' ', '-', '_'], "");
    if COMMON
        .iter()
        .any(|c| lowered == *c || squashed == c.replace([' ', '-', '_'], ""))
    {
        warnings.push(
            "This is a well-known password and will be among the first an attacker tries."
                .to_string(),
        );
    }

    let distinct = passphrase.chars().collect::<std::collections::BTreeSet<_>>().len();
    if distinct < 5 && length >= 5 {
        warnings.push(format!(
            "Only {distinct} different characters — repetition adds length but little strength."
        ));
    }

    if length < STRONG_PASSPHRASE_LEN {
        warnings.push(format!(
            "If this machine is stolen, this passphrase is the only thing protecting your keys. \
             {STRONG_PASSPHRASE_LEN} characters or more is meaningfully harder to break."
        ));
    }

    Assessment { strength, length, warnings }
}

/// Generate a random passphrase: 12 characters mixing letters, digits and
/// symbols, with at least one of each class.
///
/// Drawn from the OS CSPRNG, and by rejection sampling rather than `% len`, which
/// would bias toward the earlier characters of each alphabet.
pub fn generate_passphrase() -> String {
    use rand::RngCore;

    const LOWER: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
    const UPPER: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
    const DIGIT: &[u8] = b"23456789";
    const SYMBOL: &[u8] = b"!@#$%^&*-_=+?";

    // `l`, `I`, `O`, `0`, `1` are omitted above: this is a string a participant
    // may well write down, and a passphrase misread off paper is a lost vault.
    let all: Vec<u8> = LOWER
        .iter()
        .chain(UPPER)
        .chain(DIGIT)
        .chain(SYMBOL)
        .copied()
        .collect();

    fn pick(alphabet: &[u8]) -> u8 {
        let n = alphabet.len();
        // Reject the tail that would make the modulo non-uniform.
        let limit = (256 / n) * n;
        let mut buf = [0u8; 1];
        loop {
            rand::rngs::OsRng.fill_bytes(&mut buf);
            if (buf[0] as usize) < limit {
                return alphabet[buf[0] as usize % n];
            }
        }
    }

    // One from each class guarantees the mix; the rest is drawn from everything.
    let mut chars: Vec<u8> = vec![pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
    while chars.len() < STRONG_PASSPHRASE_LEN {
        chars.push(pick(&all));
    }

    // Fisher-Yates, so the guaranteed classes are not pinned to the first four
    // positions — that would leak structure to anyone who knows how we generate.
    for i in (1..chars.len()).rev() {
        let limit = (256 / (i + 1)) * (i + 1);
        let mut buf = [0u8; 1];
        let j = loop {
            rand::rngs::OsRng.fill_bytes(&mut buf);
            if (buf[0] as usize) < limit {
                break buf[0] as usize % (i + 1);
            }
        };
        chars.swap(i, j);
    }

    String::from_utf8(chars).expect("alphabets are ASCII")
}

/// Retained for callers that want a hard gate. Only rejects an empty passphrase —
/// length is the participant's choice.
pub fn check_passphrase_policy(passphrase: &str) -> Result<(), String> {
    if passphrase.is_empty() {
        return Err("passphrase cannot be empty".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SALT: [u8; 32] = [0x5a; 32];

    /// The participant may choose any length; only an empty passphrase is refused.
    #[test]
    fn any_length_is_permitted() {
        for p in ["a", "short", "elevenchar", "password", "Tr0ub4dor&3xKcd"] {
            assert!(check_passphrase_policy(p).is_ok(), "{p:?} must be allowed");
        }
        assert!(check_passphrase_policy("").is_err(), "empty must still be refused");
    }

    #[test]
    fn strength_bands_follow_the_specified_lengths() {
        // 6 or fewer: weak.
        for n in 1..=6 {
            assert_eq!(assess(&"x".repeat(n)).strength, Strength::Weak, "len {n}");
        }
        // 7 to 11: medium.
        for n in 7..=11 {
            assert_eq!(assess(&"x".repeat(n)).strength, Strength::Medium, "len {n}");
        }
        // 12 and above: strong.
        for n in [12, 13, 20, 64] {
            assert_eq!(assess(&"x".repeat(n)).strength, Strength::Strong, "len {n}");
        }
    }

    #[test]
    fn assessment_warns_without_blocking() {
        let a = assess("password");
        assert_eq!(a.strength, Strength::Medium, "8 chars is medium by length");
        assert!(a.warnings.iter().any(|w| w.contains("well-known")));
        // Still allowed — the warning is advice, not a veto.
        assert!(check_passphrase_policy("password").is_ok());

        let b = assess("aaaaaaaaaaaa");
        assert_eq!(b.strength, Strength::Strong, "band is by length alone");
        assert!(b.warnings.iter().any(|w| w.contains("different characters")));

        let c = assess("Tr0ub4dor&3xKcd");
        assert_eq!(c.strength, Strength::Strong);
        assert!(c.warnings.is_empty(), "a good passphrase should draw no warnings");

        assert!(assess("").warnings.iter().any(|w| w.contains("Empty")));
    }

    #[test]
    fn generated_passphrases_are_strong_and_well_mixed() {
        for _ in 0..50 {
            let p = generate_passphrase();
            assert_eq!(p.chars().count(), STRONG_PASSPHRASE_LEN);
            assert_eq!(assess(&p).strength, Strength::Strong);
            assert!(p.chars().any(|c| c.is_ascii_lowercase()), "{p}");
            assert!(p.chars().any(|c| c.is_ascii_uppercase()), "{p}");
            assert!(p.chars().any(|c| c.is_ascii_digit()), "{p}");
            assert!(p.chars().any(|c| !c.is_ascii_alphanumeric()), "{p}");
            // Ambiguous glyphs are excluded so it can be transcribed by hand.
            assert!(!p.contains(['l', 'I', 'O', '0', '1']), "ambiguous glyph in {p}");
        }
    }

    #[test]
    fn generated_passphrases_do_not_repeat() {
        let a: std::collections::BTreeSet<String> =
            (0..100).map(|_| generate_passphrase()).collect();
        assert_eq!(a.len(), 100, "generator must not collide across 100 draws");
    }

    /// The guaranteed one-of-each-class characters must not sit in fixed
    /// positions, or an attacker who knows the generator learns the layout.
    #[test]
    fn generated_class_positions_are_shuffled() {
        let mut digit_at_index_2 = 0;
        let runs = 200;
        for _ in 0..runs {
            let p = generate_passphrase();
            if p.chars().nth(2).is_some_and(|c| c.is_ascii_digit()) {
                digit_at_index_2 += 1;
            }
        }
        assert!(digit_at_index_2 < runs, "position 2 is always a digit — not shuffled");
    }

    #[test]
    fn each_custody_kind_derives_a_different_key_from_the_same_bytes() {
        // The same 64 bytes presented as a signature and as a key file must not
        // produce the same KEK, or a credential could be replayed across kinds.
        let material = [0x42u8; 64];
        let sig = SignatureOverseer::new(&material, "0xabc", "wallet").unwrap();
        let file = KeyFileOverseer::new(&material, "usb").unwrap();
        let a = sig.kek(&SALT, None).unwrap();
        let b = file.kek(&SALT, None).unwrap();
        assert_ne!(a.as_slice(), b.as_slice());
    }

    #[test]
    fn signature_custody_is_bound_to_the_address() {
        let material = [0x42u8; 64];
        let a = SignatureOverseer::new(&material, "0xaaa", "w").unwrap().kek(&SALT, None).unwrap();
        let b = SignatureOverseer::new(&material, "0xbbb", "w").unwrap().kek(&SALT, None).unwrap();
        assert_ne!(a.as_slice(), b.as_slice(), "same signature, different account");
    }

    #[test]
    fn signature_custody_is_deterministic_and_salt_bound() {
        let m = [0x42u8; 64];
        let k1 = SignatureOverseer::new(&m, "0xabc", "w").unwrap().kek(&SALT, None).unwrap();
        let k2 = SignatureOverseer::new(&m, "0xabc", "w").unwrap().kek(&SALT, None).unwrap();
        let k3 = SignatureOverseer::new(&m, "0xabc", "w").unwrap().kek(&[0x77; 32], None).unwrap();
        assert_eq!(k1.as_slice(), k2.as_slice());
        assert_ne!(k1.as_slice(), k3.as_slice(), "a different vault salt must diverge");
    }

    #[test]
    fn short_credentials_are_refused() {
        assert!(SignatureOverseer::new(&[0u8; 31], "0xabc", "w").is_err());
        assert!(KeyFileOverseer::new(&[0u8; 31], "usb").is_err());
        assert!(SignatureOverseer::new(&[0u8; 64], "0xabc", "w").is_ok());
    }

    /// Only the passphrase kind may reach the memory-hard KDF; the others are
    /// high-entropy and do not need it.
    #[test]
    fn only_passphrase_custody_declares_a_need_for_stretching() {
        assert!(CustodyKind::Passphrase.needs_stretching());
        assert!(!CustodyKind::WalletSignature.needs_stretching());
        assert!(!CustodyKind::KeyFile.needs_stretching());
    }

    #[test]
    fn binding_message_is_pinned() {
        // Changing this string orphans every signature-bound vault in existence.
        assert_eq!(BINDING_MESSAGE, "BANKON-VAULT-KEY-BINDING/v1");
    }
}
