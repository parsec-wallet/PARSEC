// bankon_vault::format — the `bankon-vault/2` on-disk format.
//
// Three layers, each with a distinct job:
//
//   custody credential ──▶ KEK   (Argon2id for a passphrase; HKDF for a
//                                 high-entropy signature or key file)
//   KEK ──AEAD-unwrap──▶  DEK   (random 32 bytes, one per vault)
//   DEK ──HKDF per entry─▶ entry key ──AES-256-GCM──▶ ciphertext
//
// The DEK layer is the reason a passphrase change costs one rewrap instead of
// re-encrypting every account, and the reason several custodians (a passphrase
// AND a wallet signature AND a recovery key) can open the same vault. None of the
// sibling implementations in this family have it; mindX's production vault
// re-encrypts every entry on rotation because the master key is derived, not
// wrapped.
//
// What is authenticated, and why it matters:
//   * every AEAD call binds `version ‖ vault_id ‖ purpose` as associated data, so
//     a ciphertext cannot be transplanted between vaults or have its metadata
//     rewritten. v1 bound nothing, which let anyone with write access to the
//     directory swap two key files and have the wallet sign with the wrong key.
//   * the KDF parameters are inside that associated data, so an edited header
//     asking for a cheap derivation fails to open rather than being honoured.
//   * entry identifiers on disk are opaque, derived from the DEK. A locked vault
//     discloses neither the addresses it holds nor how many. Production leaves
//     these in cleartext and its live vault leaks its whole account roster.
//
// There is deliberately NO sentinel value. v1 stored the fixed plaintext
// `bankon_vault_ok` purely so a passphrase could be checked, which handed an
// offline attacker a free known-plaintext oracle; Pera shipped the same idea and
// it defeats their entire KDF. Here, unwrapping the DEK *is* the check: AEAD
// authentication fails on a wrong credential, and succeeds on a right one.

use aes_gcm::aead::{Aead, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};

use super::kdf::{self, KdfParams};
use super::secure_mem::SecretBytes;

pub const FORMAT_TAG: &str = "bankon-vault/2";
pub const VERSION: u8 = 2;
pub const SALT_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
pub const DEK_LEN: usize = 32;
pub const VAULT_ID_LEN: usize = 16;
pub const OID_LEN: usize = 16;

/// What kind of key material an entry holds.
///
/// This exists so the vault can store a Falcon-1024 private key — ~2,305 bytes of
/// raw binary — alongside a 32-byte Ed25519 seed without any code path assuming a
/// length or a text encoding. v1 typed secrets as `String` and ran them through
/// `String::from_utf8`, which made post-quantum key material impossible to store
/// and blocked cp4096 commitment V on a type signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum KeyScheme {
    MnemonicBip39,
    MnemonicAlgo25,
    Ed25519,
    Secp256k1,
    Rsa4096,
    Falcon512,
    Falcon1024,
    MlDsa44,
    MlDsa65,
    MlDsa87,
    /// Caller-defined bytes. Reserved so a new scheme never requires a format bump.
    Opaque,
}

impl KeyScheme {
    /// Stable wire tag, bound into associated data. Changing one of these strings
    /// makes existing entries of that scheme fail to authenticate.
    pub fn tag(&self) -> &'static str {
        match self {
            Self::MnemonicBip39 => "mnemonic-bip39",
            Self::MnemonicAlgo25 => "mnemonic-algo25",
            Self::Ed25519 => "ed25519",
            Self::Secp256k1 => "secp256k1",
            Self::Rsa4096 => "rsa4096",
            Self::Falcon512 => "falcon512",
            Self::Falcon1024 => "falcon1024",
            Self::MlDsa44 => "ml-dsa-44",
            Self::MlDsa65 => "ml-dsa-65",
            Self::MlDsa87 => "ml-dsa-87",
            Self::Opaque => "opaque",
        }
    }

    /// Parse a wire tag. Unknown tags are rejected rather than coerced to
    /// `Opaque`: a caller naming a scheme this build does not know is a version
    /// mismatch, and silently downgrading it would lose the type information the
    /// whole scheme registry exists to carry.
    pub fn from_tag(tag: &str) -> Result<Self, String> {
        Ok(match tag {
            "mnemonic-bip39" => Self::MnemonicBip39,
            "mnemonic-algo25" => Self::MnemonicAlgo25,
            "ed25519" => Self::Ed25519,
            "secp256k1" => Self::Secp256k1,
            "rsa4096" => Self::Rsa4096,
            "falcon512" => Self::Falcon512,
            "falcon1024" => Self::Falcon1024,
            "ml-dsa-44" => Self::MlDsa44,
            "ml-dsa-65" => Self::MlDsa65,
            "ml-dsa-87" => Self::MlDsa87,
            "opaque" => Self::Opaque,
            other => return Err(format!("unknown key scheme {other:?}")),
        })
    }

    /// True if this scheme's key material is binary rather than text. Purely
    /// informational — no storage path treats the two differently.
    #[allow(dead_code)] // informational; no storage path depends on it
    pub fn is_binary(&self) -> bool {
        !matches!(self, Self::MnemonicBip39 | Self::MnemonicAlgo25)
    }
}

/// How a custodian's key-encryption key is produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CustodyKind {
    /// Low-entropy human passphrase. MUST be stretched with Argon2id.
    Passphrase,
    /// A participant wallet signature over the binding message. High entropy.
    WalletSignature,
    /// Raw high-entropy bytes from a file, typically on removable media.
    KeyFile,
}

impl CustodyKind {
    pub fn tag(&self) -> &'static str {
        match self {
            Self::Passphrase => "passphrase",
            Self::WalletSignature => "wallet-signature",
            Self::KeyFile => "key-file",
        }
    }

    /// Whether this credential must go through the memory-hard KDF.
    ///
    /// The distinction the sibling vaults lose: HKDF is an extract-and-expand
    /// step, not a password hash. Feeding a human passphrase straight into it,
    /// as walletcreator and the DeltaVerse participant vault both do, provides no
    /// stretching whatsoever.
    pub fn needs_stretching(&self) -> bool {
        matches!(self, Self::Passphrase)
    }
}

/// Nonce + ciphertext, base64 in the document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sealed {
    pub nonce: String,
    pub ct: String,
}

/// One custodian's wrapped copy of the DEK.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wrap {
    pub kind: CustodyKind,
    /// Human label so a participant can tell two custodians apart. Not secret.
    pub label: String,
    /// Per-custodian KDF parameters: a passphrase wrap carries real Argon2id cost,
    /// a signature wrap does not need it.
    pub kdf: Option<KdfParams>,
    /// Per-custodian salt, so two custodians never share a derivation.
    pub salt: String,
    pub sealed: Sealed,
    pub created_at: u64,
}

/// One stored secret. `oid` is derived from the DEK, so it discloses nothing
/// while the vault is locked.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub oid: String,
    pub scheme: KeyScheme,
    pub sealed: Sealed,
    pub updated_at: u64,
}

/// The account roster. Encrypted as a unit into `VaultDoc::index`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccountIndex {
    pub accounts: Vec<AccountRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRecord {
    pub address: String,
    pub chain: String,
    pub label: String,
    pub scheme: KeyScheme,
    pub created_at: u64,
}

/// The whole vault document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultDoc {
    pub format: String,
    pub vault_id: String,
    /// Vault-level salt for entry, oid and index derivation. Distinct from each
    /// custodian's wrap salt, so adding or removing a custodian never perturbs
    /// entry keys.
    pub salt: String,
    pub wraps: Vec<Wrap>,
    /// Encrypted `AccountIndex`. Absent only in a freshly created, empty vault.
    pub index: Option<Sealed>,
    pub entries: Vec<Entry>,
    /// Incremented on every save. With the `vault2.generation` sidecar it detects a
    /// restored older copy (audit M7).
    pub generation: u64,
    /// HMAC-SHA512 (hex) over the whole document with this field empty, keyed from
    /// the DEK: an entry or custodian removed, added or swapped outside PARSEC fails
    /// it, though each entry also authenticates on its own (audit M7).
    pub mac: String,
}

impl VaultDoc {
    pub fn new(vault_id: &[u8; VAULT_ID_LEN]) -> Self {
        Self {
            format: FORMAT_TAG.to_string(),
            vault_id: hex::encode(vault_id),
            salt: B64.encode(random_bytes(SALT_LEN)),
            wraps: Vec::new(),
            index: None,
            entries: Vec::new(),
            generation: 0,
            mac: String::new(),
        }
    }

    /// Reject anything this build does not understand.
    ///
    /// Production writes a version field and then never reads it, swallowing
    /// parse errors so a corrupted vault presents as an empty one. An unknown
    /// version here is a hard error: a wallet that cannot read its own file must
    /// say so, never silently offer the participant a blank slate.
    pub fn validate(&self) -> Result<(), String> {
        if self.format != FORMAT_TAG {
            return Err(format!(
                "unsupported vault format {:?} (this build reads {FORMAT_TAG}). \
                 Refusing to touch it — a newer PARSEC may be required.",
                self.format
            ));
        }
        if hex::decode(&self.vault_id).map(|v| v.len()) != Ok(VAULT_ID_LEN) {
            return Err("vault_id is malformed".to_string());
        }
        if self.salt_bytes().is_err() {
            return Err("vault salt is malformed".to_string());
        }
        if self.wraps.is_empty() {
            return Err("vault has no custodians — the DEK is unrecoverable".to_string());
        }
        Ok(())
    }

    pub fn vault_id_bytes(&self) -> Result<Vec<u8>, String> {
        hex::decode(&self.vault_id).map_err(|e| format!("bad vault_id: {e}"))
    }

    pub fn salt_bytes(&self) -> Result<Vec<u8>, String> {
        let s = B64.decode(&self.salt).map_err(|e| format!("bad salt: {e}"))?;
        if s.len() != SALT_LEN {
            return Err(format!("salt must be {SALT_LEN} bytes, found {}", s.len()));
        }
        Ok(s)
    }
}

// ── AEAD helpers ────────────────────────────────────────────────────────────

pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut v = vec![0u8; n];
    OsRng.fill_bytes(&mut v);
    v
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Associated data for every AEAD operation in the vault.
///
/// Binding the version, the vault identity and the purpose means a ciphertext is
/// only ever valid in the exact slot it was written to. Moving an entry between
/// vaults, renaming it, or replaying an old wrap all fail authentication rather
/// than decrypting into the wrong context.
pub fn aad(vault_id: &[u8], purpose: &str) -> Vec<u8> {
    aad_parts(vault_id, purpose, &[])
}

/// `aad` with further fields. Every field is length-prefixed (u32, big-endian), so no
/// choice of label, chain or address can make two different tuples encode the same
/// bytes — a `:`-joined string could (audit M10).
pub fn aad_parts(vault_id: &[u8], purpose: &str, fields: &[&[u8]]) -> Vec<u8> {
    let mut a = vec![VERSION];
    for f in [vault_id, purpose.as_bytes()].into_iter().chain(fields.iter().copied()) {
        lp(&mut a, f);
    }
    a
}

/// Append `field` with its u32 big-endian length.
pub fn lp(out: &mut Vec<u8>, field: &[u8]) {
    out.extend_from_slice(&(field.len() as u32).to_be_bytes());
    out.extend_from_slice(field);
}

/// An HKDF info string: a fixed label, then length-prefixed fields.
pub fn info(label: &str, fields: &[&[u8]]) -> Vec<u8> {
    let mut i = label.as_bytes().to_vec();
    for f in fields {
        lp(&mut i, f);
    }
    i
}

pub fn seal(key: &[u8], plaintext: &[u8], aad: &[u8]) -> Result<Sealed, String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init failed: {e}"))?;
    let nonce_bytes = random_bytes(NONCE_LEN);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad })
        .map_err(|e| format!("encryption failed: {e}"))?;
    Ok(Sealed {
        nonce: B64.encode(&nonce_bytes),
        ct: B64.encode(&ct),
    })
}

pub fn open(key: &[u8], sealed: &Sealed, aad: &[u8]) -> Result<SecretBytes, String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init failed: {e}"))?;
    let nonce_bytes = B64
        .decode(&sealed.nonce)
        .map_err(|e| format!("bad nonce encoding: {e}"))?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err("bad nonce length".to_string());
    }
    let ct = B64
        .decode(&sealed.ct)
        .map_err(|e| format!("bad ciphertext encoding: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let pt = cipher
        .decrypt(nonce, Payload { msg: &ct, aad })
        .map_err(|_| "authentication failed".to_string())?;
    let out = SecretBytes::from_slice(&pt);
    // `pt` is a plain Vec the AEAD allocated; wipe our copy of it.
    let mut pt = pt;
    super::secure_mem::wipe(&mut pt);
    Ok(out)
}

/// Per-entry key: HKDF over the DEK, domain-separated by the opaque entry id.
///
/// One compromised entry key reveals nothing about any other, and no per-entry
/// key is ever stored. v1 encrypted every account under a single session key.
pub fn entry_key(dek: &[u8], salt: &[u8], oid: &str) -> Result<SecretBytes, String> {
    kdf::hkdf(salt, dek, &info("bankon-entry/2", &[oid.as_bytes()]), 32)
}

/// The opaque on-disk identifier for an account.
///
/// Derived from the DEK, so the mapping from address to filename is only
/// computable by someone who can already open the vault.
pub fn entry_oid(dek: &[u8], salt: &[u8], chain: &str, address: &str) -> Result<String, String> {
    let raw = kdf::hkdf(salt, dek, &info("bankon-oid/2", &[chain.as_bytes(), address.as_bytes()]), OID_LEN)?;
    Ok(hex::encode(raw.as_slice()))
}

/// Key for the document MAC.
pub fn doc_mac_key(dek: &[u8], salt: &[u8]) -> Result<SecretBytes, String> {
    kdf::hkdf(salt, dek, &info("bankon-doc-mac/2", &[]), 32)
}

/// Key for the encrypted account index.
pub fn index_key(dek: &[u8], salt: &[u8]) -> Result<SecretBytes, String> {
    kdf::hkdf(salt, dek, &info("bankon-index/2", &[]), 32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vid() -> [u8; VAULT_ID_LEN] {
        [0x11; VAULT_ID_LEN]
    }

    #[test]
    fn seal_open_round_trips() {
        let key = [7u8; 32];
        let a = aad(&vid(), "entry:abc");
        let s = seal(&key, b"the secret", &a).unwrap();
        assert_eq!(open(&key, &s, &a).unwrap().as_slice(), b"the secret");
    }

    /// C4 gate. Associated data must make a ciphertext valid only in its own slot.
    #[test]
    fn ciphertext_cannot_be_moved_to_another_slot_or_vault() {
        let key = [7u8; 32];
        let s = seal(&key, b"secret-for-A", &aad(&vid(), "entry:A")).unwrap();

        // Same vault, different entry — the swap attack v1 permitted.
        assert!(open(&key, &s, &aad(&vid(), "entry:B")).is_err());
        // Different vault, same entry.
        assert!(open(&key, &s, &aad(&[0x22; VAULT_ID_LEN], "entry:A")).is_err());
        // Its own slot still works.
        assert!(open(&key, &s, &aad(&vid(), "entry:A")).is_ok());
    }

    #[test]
    fn wrong_key_fails_authentication_rather_than_returning_garbage() {
        let a = aad(&vid(), "dek");
        let s = seal(&[7u8; 32], b"dek-bytes", &a).unwrap();
        let err = open(&[8u8; 32], &s, &a).unwrap_err();
        assert!(err.contains("authentication failed"));
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = [7u8; 32];
        let a = aad(&vid(), "entry:A");
        let mut s = seal(&key, b"the secret", &a).unwrap();
        let mut raw = B64.decode(&s.ct).unwrap();
        raw[0] ^= 0x01;
        s.ct = B64.encode(&raw);
        assert!(open(&key, &s, &a).is_err());
    }

    /// C1 gate. A Falcon-1024 private key is ~2,305 bytes of non-UTF-8 binary.
    /// v1 could not store this at all: its IPC surface typed secrets as `String`
    /// and ran them through `String::from_utf8`.
    #[test]
    fn stores_and_returns_a_falcon_sized_non_utf8_secret() {
        let mut falcon = vec![0u8; 2305];
        OsRng.fill_bytes(&mut falcon);
        falcon[0] = 0xFF; // guarantee invalid UTF-8
        falcon[1] = 0xFE;
        assert!(String::from_utf8(falcon.clone()).is_err(), "must be non-UTF-8");

        let key = [3u8; 32];
        let a = aad(&vid(), "entry:falcon");
        let s = seal(&key, &falcon, &a).unwrap();
        assert_eq!(open(&key, &s, &a).unwrap().as_slice(), &falcon[..]);
    }

    /// M10: fields are length-prefixed, so a `:` inside one cannot collide with another split.
    #[test]
    fn info_and_aad_fields_cannot_be_reshuffled() {
        let salt = [3u8; SALT_LEN];
        let a = entry_oid(&[9u8; 32], &salt, "algo:rand", "X").unwrap();
        let b = entry_oid(&[9u8; 32], &salt, "algo", "rand:X").unwrap();
        assert_ne!(a, b);
        assert_ne!(aad_parts(&vid(), "wrap", &[b"a:b", b"c"]), aad_parts(&vid(), "wrap", &[b"a", b"b:c"]));
    }

    #[test]
    fn entry_keys_are_distinct_per_entry_and_stable() {
        let dek = [9u8; 32];
        let salt = [1u8; SALT_LEN];
        let a = entry_key(&dek, &salt, "oid-a").unwrap();
        let b = entry_key(&dek, &salt, "oid-b").unwrap();
        let a2 = entry_key(&dek, &salt, "oid-a").unwrap();
        assert_ne!(a.as_slice(), b.as_slice());
        assert_eq!(a.as_slice(), a2.as_slice());
    }

    #[test]
    fn opaque_ids_hide_the_address_and_need_the_dek() {
        let salt = [1u8; SALT_LEN];
        let addr = "ABIZJORU6VRN4U5G2WZX2DEZ2WBWKWRRCTHCWH2TRMG3ZYAOCDNRNSWKHA";
        let oid = entry_oid(&[9u8; 32], &salt, "algorand", addr).unwrap();
        assert!(!oid.contains(&addr[..8]), "oid must not embed the address");
        assert_eq!(oid.len(), OID_LEN * 2);
        // A different DEK yields a different id, so the mapping is not guessable.
        let other = entry_oid(&[8u8; 32], &salt, "algorand", addr).unwrap();
        assert_ne!(oid, other);
    }

    #[test]
    fn unknown_format_is_a_hard_error_not_an_empty_vault() {
        let mut doc = VaultDoc::new(&vid());
        doc.wraps.push(Wrap {
            kind: CustodyKind::Passphrase,
            label: "primary".into(),
            kdf: Some(KdfParams::DESKTOP),
            salt: B64.encode([0u8; SALT_LEN]),
            sealed: Sealed { nonce: String::new(), ct: String::new() },
            created_at: 0,
        });
        assert!(doc.validate().is_ok());

        doc.format = "bankon-vault/3".into();
        let err = doc.validate().unwrap_err();
        assert!(err.contains("unsupported vault format"), "got: {err}");
    }

    #[test]
    fn a_vault_with_no_custodians_is_rejected() {
        let doc = VaultDoc::new(&vid());
        assert!(doc.validate().unwrap_err().contains("no custodians"));
    }

    #[test]
    fn every_scheme_has_a_distinct_stable_tag() {
        let all = [
            KeyScheme::MnemonicBip39, KeyScheme::MnemonicAlgo25, KeyScheme::Ed25519,
            KeyScheme::Secp256k1, KeyScheme::Rsa4096, KeyScheme::Falcon512,
            KeyScheme::Falcon1024, KeyScheme::MlDsa44, KeyScheme::MlDsa65,
            KeyScheme::MlDsa87, KeyScheme::Opaque,
        ];
        let mut tags: Vec<&str> = all.iter().map(|s| s.tag()).collect();
        tags.sort_unstable();
        let n = tags.len();
        tags.dedup();
        assert_eq!(tags.len(), n, "scheme tags must be unique");
        for sc in all {
            assert_eq!(KeyScheme::from_tag(sc.tag()).unwrap(), sc, "tag round-trip");
        }
        assert!(KeyScheme::from_tag("nope").is_err());
        assert!(KeyScheme::Falcon1024.is_binary());
        assert!(!KeyScheme::MnemonicAlgo25.is_binary());
    }
}
