// bankon_vault::vault — the `bankon-vault/2` store.
//
// Owns the document lifecycle: create, unlock, seal and open entries, manage
// custodians, and migrate a v1 vault forward. The crypto lives in `format`, the
// KDFs in `kdf`, and custody in `overseer`; this module is the policy that binds
// them and the only place that touches the filesystem.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use super::format::{
    self, AccountIndex, AccountRecord, CustodyKind, Entry, KeyScheme, VaultDoc, Wrap, DEK_LEN,
    SALT_LEN, VAULT_ID_LEN,
};
use super::overseer::Overseer;
use super::secure_mem::SecretBytes;
use super::store::VaultStore;

pub const DOC_FILE: &str = "vault2.json";
pub const BACKUP_FILE: &str = "vault2.json.bak";

/// A loaded vault document plus the directory it came from.
pub struct Vault {
    dir: PathBuf,
    doc: VaultDoc,
}

/// The unwrapped data-encryption key. Held only while the vault is unlocked.
pub struct Dek(SecretBytes);

impl Dek {
    fn as_slice(&self) -> &[u8] {
        self.0.as_slice()
    }
}

/// Redacting. The DEK opens every entry in the vault; it must never be printable
/// into a panic message, a log line, or a CI transcript.
impl std::fmt::Debug for Dek {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Dek(<redacted>, {} bytes)", self.0.len())
    }
}

/// Summary only. Everything inside `doc` is ciphertext, but the summary avoids
/// even that so a debug print can never become an exfiltration path.
impl std::fmt::Debug for Vault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Vault")
            .field("dir", &self.dir)
            .field("format", &self.doc.format)
            .field("entries", &self.doc.entries.len())
            .field("custodians", &self.doc.wraps.len())
            .finish()
    }
}

impl Vault {
    pub fn doc_path(dir: &Path) -> PathBuf {
        dir.join(DOC_FILE)
    }

    pub fn exists(dir: &Path) -> bool {
        Self::doc_path(dir).exists()
    }

    /// Create a vault with one initial custodian.
    ///
    /// The DEK is random and is never derived from the credential, so changing
    /// the passphrase later rewraps 32 bytes instead of re-encrypting everything.
    pub fn create(dir: &Path, overseer: &dyn Overseer) -> Result<Self, String> {
        if Self::exists(dir) {
            return Err("vault already exists".to_string());
        }
        // The same total-loss guard v1 lacked: never initialise over ciphertext.
        // M9: a lone `vault2.json.bak` is the only copy of a vault; never create over it.
        if VaultStore::has_any_artefact(dir) || dir.join(BACKUP_FILE).exists() {
            return Err(format!(
                "refusing to create a vault at {}: an earlier vault's data is \
                 already present. Migrate it instead, or move it aside deliberately.",
                dir.display()
            ));
        }
        std::fs::create_dir_all(dir).map_err(|e| format!("failed to create vault dir: {e}"))?;

        let mut vid = [0u8; VAULT_ID_LEN];
        vid.copy_from_slice(&format::random_bytes(VAULT_ID_LEN));
        let mut doc = VaultDoc::new(&vid);

        let dek = SecretBytes::from_slice(&format::random_bytes(DEK_LEN));
        let wrap = Self::make_wrap(&doc, overseer, dek.as_slice())?;
        doc.wraps.push(wrap);

        let mut v = Self { dir: dir.to_path_buf(), doc };
        v.write_index(&Dek(dek), &AccountIndex::default())?;
        v.save()?;
        Ok(v)
    }

    pub fn load(dir: &Path) -> Result<Self, String> {
        let path = Self::doc_path(dir);
        let raw = std::fs::read(&path).map_err(|e| format!("failed to read vault: {e}"))?;
        // Parse errors are hard errors. Production swallows them, which turns a
        // corrupted vault into an apparently empty one — the participant is told
        // their wallet is new when in fact their keys are unreadable.
        let doc: VaultDoc = serde_json::from_slice(&raw)
            .map_err(|e| format!("vault document is corrupt or unreadable: {e}"))?;
        doc.validate()?;
        Ok(Self { dir: dir.to_path_buf(), doc })
    }

    fn make_wrap(doc: &VaultDoc, overseer: &dyn Overseer, dek: &[u8]) -> Result<Wrap, String> {
        let salt = format::random_bytes(SALT_LEN);
        let params = overseer.kdf_params();
        let kek = overseer.kek(&salt, params)?;
        let vid = doc.vault_id_bytes()?;
        let aad = Self::wrap_aad(&vid, overseer.kind(), overseer.label());
        let sealed = format::seal(kek.as_slice(), dek, &aad)?;
        Ok(Wrap {
            kind: overseer.kind(),
            label: overseer.label().to_string(),
            kdf: params,
            salt: B64.encode(&salt),
            sealed,
            created_at: format::now_secs(),
        })
    }

    /// Associated data for a DEK wrap. The custody kind and label are bound in,
    /// so a wrap cannot be relabelled or reinterpreted as a different kind.
    fn wrap_aad(vault_id: &[u8], kind: CustodyKind, label: &str) -> Vec<u8> {
        format::aad(vault_id, &format!("wrap:{}:{}", kind.tag(), label))
    }

    /// Unwrap the DEK with any custodian that matches.
    ///
    /// There is no sentinel and no verification token: AEAD authentication on the
    /// wrap *is* the check. A wrong credential produces an authentication failure,
    /// which is indistinguishable from noise and gives an offline attacker no
    /// confirmation oracle cheaper than the Argon2id derivation itself.
    pub fn unlock(&self, overseer: &dyn Overseer) -> Result<Dek, String> {
        let vid = self.doc.vault_id_bytes()?;
        let kind = overseer.kind();
        let mut tried = 0usize;

        for wrap in self.doc.wraps.iter().filter(|w| w.kind == kind) {
            tried += 1;
            let salt = match B64.decode(&wrap.salt) {
                Ok(s) if s.len() == SALT_LEN => s,
                _ => continue,
            };
            let Ok(kek) = overseer.kek(&salt, wrap.kdf) else {
                continue;
            };
            let aad = Self::wrap_aad(&vid, wrap.kind, &wrap.label);
            if let Ok(dek) = format::open(kek.as_slice(), &wrap.sealed, &aad) {
                if dek.len() != DEK_LEN {
                    return Err("unwrapped DEK has the wrong length".to_string());
                }
                return Ok(Dek(dek));
            }
        }

        if tried == 0 {
            return Err(format!(
                "this vault has no {} custodian",
                kind.tag()
            ));
        }
        Err("wrong passphrase or credential".to_string())
    }

    /// Register an additional custodian for the same DEK.
    ///
    /// This is what makes a passphrase and a wallet signature two doors into one
    /// vault rather than two separate products, and it is why signature-bound
    /// custody is survivable: bind a second custodian and losing the wallet key
    /// is no longer losing the vault.
    pub fn add_custodian(&mut self, dek: &Dek, overseer: &dyn Overseer) -> Result<(), String> {
        if self
            .doc
            .wraps
            .iter()
            .any(|w| w.kind == overseer.kind() && w.label == overseer.label())
        {
            return Err(format!(
                "a {} custodian labelled {:?} already exists",
                overseer.kind().tag(),
                overseer.label()
            ));
        }
        let wrap = Self::make_wrap(&self.doc, overseer, dek.as_slice())?;
        self.doc.wraps.push(wrap);
        self.save()
    }

    /// Remove a custodian, refusing to remove the last one.
    pub fn remove_custodian(&mut self, kind: CustodyKind, label: &str) -> Result<(), String> {
        if self.doc.wraps.len() <= 1 {
            return Err(
                "refusing to remove the only custodian — the vault would become \
                 permanently unopenable"
                    .to_string(),
            );
        }
        let before = self.doc.wraps.len();
        self.doc.wraps.retain(|w| !(w.kind == kind && w.label == label));
        if self.doc.wraps.len() == before {
            return Err("no such custodian".to_string());
        }
        self.save()
    }

    /// Replace a passphrase custodian. O(1): one 32-byte rewrap, no entry is touched.
    pub fn change_passphrase(
        &mut self,
        dek: &Dek,
        label: &str,
        new_overseer: &dyn Overseer,
    ) -> Result<(), String> {
        let wrap = Self::make_wrap(&self.doc, new_overseer, dek.as_slice())?;
        match self
            .doc
            .wraps
            .iter_mut()
            .find(|w| w.kind == CustodyKind::Passphrase && w.label == label)
        {
            Some(slot) => *slot = wrap,
            None => return Err(format!("no passphrase custodian labelled {label:?}")),
        }
        self.save()
    }

    // ── entries ─────────────────────────────────────────────────────────────

    fn oid(&self, dek: &Dek, chain: &str, address: &str) -> Result<String, String> {
        let salt = self.doc.salt_bytes()?;
        format::entry_oid(dek.as_slice(), &salt, chain, address)
    }

    fn entry_aad(&self, oid: &str, scheme: KeyScheme) -> Result<Vec<u8>, String> {
        let vid = self.doc.vault_id_bytes()?;
        Ok(format::aad(&vid, &format!("entry:{}:{}", oid, scheme.tag())))
    }

    pub fn store_secret(
        &mut self,
        dek: &Dek,
        chain: &str,
        address: &str,
        label: &str,
        scheme: KeyScheme,
        secret: &[u8],
    ) -> Result<(), String> {
        let salt = self.doc.salt_bytes()?;
        let oid = self.oid(dek, chain, address)?;
        let ekey = format::entry_key(dek.as_slice(), &salt, &oid)?;
        let aad = self.entry_aad(&oid, scheme)?;
        let sealed = format::seal(ekey.as_slice(), secret, &aad)?;

        let now = format::now_secs();
        match self.doc.entries.iter_mut().find(|e| e.oid == oid) {
            Some(e) => {
                e.sealed = sealed;
                e.scheme = scheme;
                e.updated_at = now;
            }
            None => self.doc.entries.push(Entry {
                oid: oid.clone(),
                scheme,
                sealed,
                updated_at: now,
            }),
        }

        let mut index = self.read_index(dek)?;
        index.accounts.retain(|a| !(a.address == address && a.chain == chain));
        index.accounts.push(AccountRecord {
            address: address.to_string(),
            chain: chain.to_string(),
            label: label.to_string(),
            scheme,
            created_at: now,
        });
        self.write_index(dek, &index)?;
        self.save()
    }

    pub fn retrieve_secret(
        &self,
        dek: &Dek,
        chain: &str,
        address: &str,
    ) -> Result<SecretBytes, String> {
        let salt = self.doc.salt_bytes()?;
        let oid = self.oid(dek, chain, address)?;
        let entry = self
            .doc
            .entries
            .iter()
            .find(|e| e.oid == oid)
            // A missing entry and a failed authentication are distinct errors.
            // Production conflates them by returning None for both, so a corrupted
            // vault is indistinguishable from an empty one.
            .ok_or_else(|| format!("no key stored for {chain}:{address}"))?;
        let ekey = format::entry_key(dek.as_slice(), &salt, &oid)?;
        let aad = self.entry_aad(&oid, entry.scheme)?;
        format::open(ekey.as_slice(), &entry.sealed, &aad)
    }

    pub fn scheme_of(&self, dek: &Dek, chain: &str, address: &str) -> Result<KeyScheme, String> {
        let oid = self.oid(dek, chain, address)?;
        self.doc
            .entries
            .iter()
            .find(|e| e.oid == oid)
            .map(|e| e.scheme)
            .ok_or_else(|| format!("no key stored for {chain}:{address}"))
    }

    pub fn remove_account(&mut self, dek: &Dek, chain: &str, address: &str) -> Result<(), String> {
        let oid = self.oid(dek, chain, address)?;
        self.doc.entries.retain(|e| e.oid != oid);
        let mut index = self.read_index(dek)?;
        index.accounts.retain(|a| !(a.address == address && a.chain == chain));
        self.write_index(dek, &index)?;
        self.save()
    }

    /// The account roster. Requires the DEK — a locked vault discloses neither
    /// which accounts it holds nor how many.
    pub fn list_accounts(&self, dek: &Dek) -> Result<Vec<AccountRecord>, String> {
        Ok(self.read_index(dek)?.accounts)
    }

    /// How many entries exist, without revealing what they are. Safe while locked.
    pub fn entry_count(&self) -> usize {
        self.doc.entries.len()
    }

    pub fn custodians(&self) -> Vec<(CustodyKind, String)> {
        self.doc.wraps.iter().map(|w| (w.kind, w.label.clone())).collect()
    }

    fn read_index(&self, dek: &Dek) -> Result<AccountIndex, String> {
        let Some(sealed) = &self.doc.index else {
            return Ok(AccountIndex::default());
        };
        let salt = self.doc.salt_bytes()?;
        let vid = self.doc.vault_id_bytes()?;
        let key = format::index_key(dek.as_slice(), &salt)?;
        let plain = format::open(key.as_slice(), sealed, &format::aad(&vid, "index"))?;
        serde_json::from_slice(plain.as_slice())
            .map_err(|e| format!("account index is corrupt: {e}"))
    }

    fn write_index(&mut self, dek: &Dek, index: &AccountIndex) -> Result<(), String> {
        let salt = self.doc.salt_bytes()?;
        let vid = self.doc.vault_id_bytes()?;
        let key = format::index_key(dek.as_slice(), &salt)?;
        let mut plain =
            serde_json::to_vec(index).map_err(|e| format!("index serialize failed: {e}"))?;
        let sealed = format::seal(key.as_slice(), &plain, &format::aad(&vid, "index"))?;
        super::secure_mem::wipe(&mut plain);
        self.doc.index = Some(sealed);
        Ok(())
    }

    /// Persist, retaining the previous generation as `.bak`.
    ///
    /// The whole vault is one document, so a bad write is a total loss. The write
    /// itself is atomic (temp, fsync, rename, fsync parent) and the prior version
    /// is kept, which together give the same crash safety as production's
    /// snapshot-and-candidate ceremony at a fraction of the machinery.
    pub fn save(&self) -> Result<(), String> {
        let path = Self::doc_path(&self.dir);
        if path.exists() {
            let _ = std::fs::copy(&path, self.dir.join(BACKUP_FILE));
        }
        let data = serde_json::to_vec_pretty(&self.doc)
            .map_err(|e| format!("vault serialize failed: {e}"))?;
        VaultStore::write_atomic(&path, &data)
    }
}

// ── migration from v1 ───────────────────────────────────────────────────────

/// Migrate a v1 vault (plaintext manifest + per-account `.enc` files, one session
/// key for everything, no AAD) to `bankon-vault/2`.
///
/// Every secret is decrypted with the v1 scheme and re-sealed under a fresh DEK
/// with per-entry keys and full associated data. The v1 files are left in place:
/// this is a participant's key material and the migration is verified by reading
/// every secret back before the old copy is even considered for removal.
pub fn migrate_v1(
    dir: &Path,
    passphrase: &str,
    overseer: &dyn Overseer,
) -> Result<Vault, String> {
    if Vault::exists(dir) {
        return Err("a v2 vault already exists here".to_string());
    }
    if !VaultStore::exists(dir) {
        return Err("no v1 vault found to migrate".to_string());
    }
    if !VaultStore::verify_passphrase(dir, passphrase.as_bytes())? {
        return Err("wrong passphrase for the existing vault".to_string());
    }

    let old_key = VaultStore::derive_session_key(dir, passphrase.as_bytes())?;
    let manifest = VaultStore::read_manifest(dir)?;

    // Collect and verify everything BEFORE writing anything.
    let mut staged: Vec<(AccountRecord, SecretBytes)> = Vec::new();
    for account in &manifest.accounts {
        let secret = VaultStore::retrieve_secret(dir, &old_key, &account.address)
            .map_err(|e| format!("cannot read {}: {e} — migration aborted", account.address))?;
        let scheme = infer_scheme(&account.chain, &secret);
        staged.push((
            AccountRecord {
                address: account.address.clone(),
                chain: account.chain.clone(),
                label: account.label.clone(),
                scheme,
                created_at: account.created_at,
            },
            SecretBytes::from_slice(&secret),
        ));
    }

    let mut vid = [0u8; VAULT_ID_LEN];
    vid.copy_from_slice(&format::random_bytes(VAULT_ID_LEN));
    let mut doc = VaultDoc::new(&vid);
    let dek = SecretBytes::from_slice(&format::random_bytes(DEK_LEN));
    doc.wraps.push(Vault::make_wrap(&doc, overseer, dek.as_slice())?);

    let mut v = Vault { dir: dir.to_path_buf(), doc };
    let dek = Dek(dek);
    v.write_index(&dek, &AccountIndex::default())?;

    for (record, secret) in &staged {
        v.store_secret(
            &dek,
            &record.chain,
            &record.address,
            &record.label,
            record.scheme,
            secret.as_slice(),
        )?;
    }

    // Read every secret back through the new format before declaring success.
    for (record, secret) in &staged {
        let got = v.retrieve_secret(&dek, &record.chain, &record.address)?;
        if got.as_slice() != secret.as_slice() {
            return Err(format!(
                "migration verification failed for {} — v1 data left untouched",
                record.address
            ));
        }
    }

    Ok(v)
}

/// Best-effort classification of a v1 secret, which carried no scheme tag.
pub fn infer_scheme(chain: &str, secret: &[u8]) -> KeyScheme {
    let text = std::str::from_utf8(secret).ok();
    match text {
        Some(t) => {
            let words = t.split_whitespace().count();
            match (chain, words) {
                ("algorand", 25) => KeyScheme::MnemonicAlgo25,
                (_, 12) | (_, 15) | (_, 18) | (_, 21) | (_, 24) => KeyScheme::MnemonicBip39,
                _ => KeyScheme::Opaque,
            }
        }
        None => KeyScheme::Opaque,
    }
}

/// Chains present in a v1 vault, for reporting a migration plan to the UI.
pub fn v1_chains(dir: &Path) -> Result<BTreeSet<String>, String> {
    Ok(VaultStore::read_manifest(dir)?
        .accounts
        .into_iter()
        .map(|a| a.chain)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::kdf::KdfParams;
    use super::super::overseer::{KeyFileOverseer, PassphraseOverseer, SignatureOverseer};

    fn scratch(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir()
            .join(format!("bkv2_{}_{}_{}", tag, std::process::id(), nanos));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Key-file custody skips Argon2id, keeping most tests fast. Passphrase tests
    /// below deliberately pay the real memory-hard cost at the floor.
    fn keyfile(label: &str) -> KeyFileOverseer {
        KeyFileOverseer::new(&[0xA5u8; 64], label).unwrap()
    }

    fn pass(p: &str) -> PassphraseOverseer {
        PassphraseOverseer::new(p, "primary", KdfParams::FLOOR).unwrap()
    }

    /// M9: the backup file alone is a vault's only copy; create must not overwrite it.
    #[test]
    fn create_refuses_over_a_lone_backup() {
        let d = scratch("bak");
        std::fs::write(d.join(BACKUP_FILE), b"{}").unwrap();
        assert!(Vault::create(&d, &keyfile("usb")).is_err());
        assert_eq!(std::fs::read(d.join(BACKUP_FILE)).unwrap(), b"{}");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn create_store_retrieve_round_trip() {
        let d = scratch("rt");
        let o = keyfile("usb");
        let mut v = Vault::create(&d, &o).unwrap();
        let dek = v.unlock(&o).unwrap();

        v.store_secret(&dek, "algorand", "ADDR1", "main", KeyScheme::MnemonicAlgo25, b"twenty five words here")
            .unwrap();

        let reloaded = Vault::load(&d).unwrap();
        let dek2 = reloaded.unlock(&o).unwrap();
        assert_eq!(
            reloaded.retrieve_secret(&dek2, "algorand", "ADDR1").unwrap().as_slice(),
            b"twenty five words here"
        );
        let accts = reloaded.list_accounts(&dek2).unwrap();
        assert_eq!(accts.len(), 1);
        assert_eq!(accts[0].address, "ADDR1");
        std::fs::remove_dir_all(&d).ok();
    }

    /// C1 gate, end to end through the real store: a Falcon-1024-sized binary key.
    #[test]
    fn stores_a_falcon_1024_sized_binary_key_end_to_end() {
        let d = scratch("falcon");
        let o = keyfile("usb");
        let mut v = Vault::create(&d, &o).unwrap();
        let dek = v.unlock(&o).unwrap();

        let mut falcon = format::random_bytes(2305);
        falcon[0] = 0xFF;
        falcon[1] = 0xFE;
        assert!(String::from_utf8(falcon.clone()).is_err());

        v.store_secret(&dek, "algorand", "PQADDR", "falcon", KeyScheme::Falcon1024, &falcon)
            .unwrap();
        let got = v.retrieve_secret(&dek, "algorand", "PQADDR").unwrap();
        assert_eq!(got.as_slice(), &falcon[..]);
        assert_eq!(v.scheme_of(&dek, "algorand", "PQADDR").unwrap(), KeyScheme::Falcon1024);
        std::fs::remove_dir_all(&d).ok();
    }

    /// C3 gate at the v2 layer: base64url addresses differing only in `-` vs `_`
    /// are separate entries with separate keys.
    #[test]
    fn base64url_lookalike_addresses_stay_separate() {
        let d = scratch("c3v2");
        let o = keyfile("usb");
        let mut v = Vault::create(&d, &o).unwrap();
        let dek = v.unlock(&o).unwrap();
        let a = "7fLd-Wr3xQ2mB-kT9pYc0NvHgJ5sZaEuXiO1RtQwPzM";
        let b = "7fLd_Wr3xQ2mB_kT9pYc0NvHgJ5sZaEuXiO1RtQwPzM";

        v.store_secret(&dek, "arweave", a, "one", KeyScheme::Rsa4096, b"secret-a").unwrap();
        v.store_secret(&dek, "arweave", b, "two", KeyScheme::Rsa4096, b"secret-b").unwrap();

        assert_eq!(v.retrieve_secret(&dek, "arweave", a).unwrap().as_slice(), b"secret-a");
        assert_eq!(v.retrieve_secret(&dek, "arweave", b).unwrap().as_slice(), b"secret-b");
        assert_eq!(v.entry_count(), 2);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn wrong_credential_is_refused_without_a_confirmation_oracle() {
        let d = scratch("wrong");
        let o = keyfile("usb");
        let _v = Vault::create(&d, &o).unwrap();
        let v = Vault::load(&d).unwrap();

        let bad = KeyFileOverseer::new(&[0x11u8; 64], "usb").unwrap();
        let err = v.unlock(&bad).unwrap_err();
        assert!(err.contains("wrong passphrase or credential"), "got: {err}");

        // There is no sentinel file and no fixed known plaintext anywhere.
        let raw = std::fs::read_to_string(Vault::doc_path(&d)).unwrap();
        assert!(!raw.contains("bankon_vault_ok"));
        assert!(!d.join(".verify").exists());
        std::fs::remove_dir_all(&d).ok();
    }

    /// H9 gate. Changing the passphrase must rewrap the DEK and leave every entry
    /// ciphertext byte-identical — O(1), not O(n).
    #[test]
    fn passphrase_change_is_o1_and_never_touches_entry_ciphertext() {
        let d = scratch("rotate");
        let o = pass("Tr0ub4dor&3xKcd");
        let mut v = Vault::create(&d, &o).unwrap();
        let dek = v.unlock(&o).unwrap();
        v.store_secret(&dek, "algorand", "ADDR1", "main", KeyScheme::MnemonicAlgo25, b"the mnemonic")
            .unwrap();

        let before: Vec<String> = v.doc.entries.iter().map(|e| e.sealed.ct.clone()).collect();

        let new_o = PassphraseOverseer::new("An3ntirelyD1fferent!", "primary", KdfParams::FLOOR).unwrap();
        v.change_passphrase(&dek, "primary", &new_o).unwrap();

        let after: Vec<String> = v.doc.entries.iter().map(|e| e.sealed.ct.clone()).collect();
        assert_eq!(before, after, "entry ciphertexts must be untouched by rotation");

        // Old credential no longer opens it; new one does, and the secret survives.
        let reloaded = Vault::load(&d).unwrap();
        assert!(reloaded.unlock(&o).is_err());
        let dek2 = reloaded.unlock(&new_o).unwrap();
        assert_eq!(
            reloaded.retrieve_secret(&dek2, "algorand", "ADDR1").unwrap().as_slice(),
            b"the mnemonic"
        );
        std::fs::remove_dir_all(&d).ok();
    }

    /// Several custodians, one vault: the property that makes signature-bound
    /// custody survivable and that no sibling implementation offers.
    #[test]
    fn multiple_custodians_open_the_same_vault() {
        let d = scratch("multi");
        let file = keyfile("usb");
        let mut v = Vault::create(&d, &file).unwrap();
        let dek = v.unlock(&file).unwrap();

        v.store_secret(&dek, "evm", "0xabc", "main", KeyScheme::Secp256k1, b"privkey-bytes")
            .unwrap();

        let sig = SignatureOverseer::new(&[0x42u8; 65], "0xabc", "wallet").unwrap();
        v.add_custodian(&dek, &sig).unwrap();

        let reloaded = Vault::load(&d).unwrap();
        assert_eq!(reloaded.custodians().len(), 2);
        for o in [&file as &dyn Overseer, &sig as &dyn Overseer] {
            let dk = reloaded.unlock(o).unwrap();
            assert_eq!(
                reloaded.retrieve_secret(&dk, "evm", "0xabc").unwrap().as_slice(),
                b"privkey-bytes"
            );
        }
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn debug_impls_never_render_key_material() {
        let d = scratch("dbg");
        let o = keyfile("usb");
        let v = Vault::create(&d, &o).unwrap();
        let dek = v.unlock(&o).unwrap();
        let rendered = format!("{dek:?} {v:?}");
        assert!(rendered.contains("redacted"));
        // The DEK bytes must not appear in any rendering.
        assert!(!rendered.contains(&hex::encode(dek.as_slice())));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn refuses_to_remove_the_last_custodian() {
        let d = scratch("lastcust");
        let o = keyfile("usb");
        let mut v = Vault::create(&d, &o).unwrap();
        let err = v.remove_custodian(CustodyKind::KeyFile, "usb").unwrap_err();
        assert!(err.contains("only custodian"), "got: {err}");
        std::fs::remove_dir_all(&d).ok();
    }

    /// A locked vault must disclose neither addresses nor chains nor labels.
    /// Production leaves this metadata in cleartext and leaks its whole roster.
    #[test]
    fn locked_vault_discloses_no_account_metadata() {
        let d = scratch("privacy");
        let o = keyfile("usb");
        let mut v = Vault::create(&d, &o).unwrap();
        let dek = v.unlock(&o).unwrap();
        v.store_secret(&dek, "algorand", "SECRETADDRESS12345", "my savings", KeyScheme::MnemonicAlgo25, b"m")
            .unwrap();

        let raw = std::fs::read_to_string(Vault::doc_path(&d)).unwrap();
        assert!(!raw.contains("SECRETADDRESS12345"), "address leaked on disk");
        assert!(!raw.contains("my savings"), "label leaked on disk");
        assert!(!raw.contains("algorand"), "chain leaked on disk");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn corrupt_document_is_an_error_not_an_empty_vault() {
        let d = scratch("corrupt");
        let o = keyfile("usb");
        Vault::create(&d, &o).unwrap();
        std::fs::write(Vault::doc_path(&d), b"{ not json").unwrap();
        let err = Vault::load(&d).unwrap_err();
        assert!(err.contains("corrupt or unreadable"), "got: {err}");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn save_retains_the_previous_generation() {
        let d = scratch("bak");
        let o = keyfile("usb");
        let mut v = Vault::create(&d, &o).unwrap();
        let dek = v.unlock(&o).unwrap();
        v.store_secret(&dek, "evm", "0x1", "a", KeyScheme::Secp256k1, b"k").unwrap();
        assert!(d.join(BACKUP_FILE).exists(), "previous generation must be kept");
        std::fs::remove_dir_all(&d).ok();
    }

    // ── migration ───────────────────────────────────────────────────────────

    #[test]
    fn migrates_a_v1_vault_and_preserves_every_secret() {
        let d = scratch("migrate");
        let pw = "Tr0ub4dor&3xKcd";

        // Build a v1 vault exactly as the shipped code would have.
        VaultStore::create(&d, pw.as_bytes()).unwrap();
        let old_key = VaultStore::derive_session_key(&d, pw.as_bytes()).unwrap();
        VaultStore::store_secret(&d, &old_key, "ALGOADDR", "algorand", "main",
            b"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon invest").unwrap();
        VaultStore::store_secret(&d, &old_key, "0xEVM", "evm", "trading", b"0xdeadbeef").unwrap();

        let o = pass(pw);
        let v = migrate_v1(&d, pw, &o).unwrap();
        let dek = v.unlock(&o).unwrap();

        assert_eq!(v.entry_count(), 2);
        assert_eq!(
            v.retrieve_secret(&dek, "evm", "0xEVM").unwrap().as_slice(),
            b"0xdeadbeef"
        );
        assert!(v
            .retrieve_secret(&dek, "algorand", "ALGOADDR")
            .unwrap()
            .as_slice()
            .starts_with(b"abandon"));

        // The 25-word Algorand mnemonic must be tagged as such, not as BIP-39.
        assert_eq!(
            v.scheme_of(&dek, "algorand", "ALGOADDR").unwrap(),
            KeyScheme::MnemonicAlgo25
        );

        // v1 data is left in place; migration is non-destructive.
        assert!(VaultStore::exists(&d));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn migration_refuses_a_wrong_passphrase_and_writes_nothing() {
        let d = scratch("migbad");
        VaultStore::create(&d, b"Tr0ub4dor&3xKcd").unwrap();
        let o = pass("An3ntirelyD1fferent!");
        assert!(migrate_v1(&d, "An3ntirelyD1fferent!", &o).is_err());
        assert!(!Vault::exists(&d), "no v2 document may be written on failure");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn create_refuses_to_overwrite_an_existing_v1_vault() {
        let d = scratch("nooverwrite");
        VaultStore::create(&d, b"Tr0ub4dor&3xKcd").unwrap();
        let err = Vault::create(&d, &keyfile("usb")).unwrap_err();
        assert!(err.contains("already present"), "got: {err}");
        std::fs::remove_dir_all(&d).ok();
    }
}
