// bankon_vault::commands — Tauri IPC commands
// These are the only interface between frontend and vault.
// Secrets flow: frontend → Rust (encrypt) → disk
//               disk → Rust (decrypt) → the Keycore signers, never the frontend;
//               the one exception is vault_export_secret (re-authenticated backup).

use tauri::AppHandle;
use tauri::Manager;

use super::store::{VaultStore, AccountEntry};
use super::VaultState;

/// The active profile's vault directory. The `default` profile is the original
/// `app_data_dir/bankon_vault`; see `profiles.rs`.
fn vault_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    super::profiles::active_dir(app)
}

/// Check vault status — exists? unlocked?
#[tauri::command]
pub fn vault_status(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;
    let exists = VaultStore::exists(&dir);
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let exists = exists || super::vault::Vault::exists(&dir);

    let accounts: Vec<serde_json::Value> = if guard.v2().is_some() {
        // bankon-vault/2: the roster is in the encrypted index, readable only while open.
        guard
            .accounts()?
            .into_iter()
            .map(|(address, chain, label, _)| serde_json::json!({ "address": address, "chain": chain, "label": label }))
            .collect()
    } else if exists {
        VaultStore::read_manifest(&dir)
            .map(|m| {
                m.accounts
                    .iter()
                    .map(|a| serde_json::json!({
                        "address": a.address,
                        "chain": a.chain,
                        "label": a.label,
                    }))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    let profile = app
        .path()
        .app_data_dir()
        .map(|base| super::profiles::active_in(&base))
        .unwrap_or_else(|_| super::profiles::DEFAULT_PROFILE.to_string());

    Ok(serde_json::json!({
        "exists": exists,
        "unlocked": guard.is_unlocked(),
        "accounts": accounts,
        "profile": profile,
    }))
}

/// Create a new vault with a passphrase — a `bankon-vault/2` vault since 0.2.7, at the
/// platform's Argon2id cost (256 MiB desktop, 64 MiB phone), passes calibrated to ~750 ms.
#[tauri::command]
pub async fn vault_create(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    if passphrase.len() < 8 {
        return Err("passphrase must be at least 8 characters".to_string());
    }

    let dir = vault_dir(&app)?;
    // Any trace of a vault, of either generation, means one is here, perhaps damaged.
    if VaultStore::has_any_artefact(&dir) || super::vault::Vault::exists(&dir) {
        return Err("a vault (or part of one) already exists here; it was not overwritten".to_string());
    }

    let params = super::kdf::calibrate(750);
    let overseer = super::overseer::PassphraseOverseer::new(&passphrase, "primary", params)?;
    let v = super::vault::Vault::create(&dir, &overseer)?;
    let dek = v.unlock(&overseer)?;
    state.inner.lock().map_err(|_| "vault state poisoned")?.unlock_v2(v, dek, dir);

    Ok(serde_json::json!({ "ok": true, "format": "bankon-vault/2" }))
}

/// Unlock the vault — verifies the passphrase, starts a session.
///
/// A `bankon-vault/2` vault opens directly. A `bankon-vault/1` vault is migrated on this
/// unlock: verified, rebuilt as v2 (atomically, read back from disk before it is put in
/// place — `vault::migrate_v1`), and opened as v2. The v1 files are left where they were
/// until the person removes them (`vault_remove_v1_files`). Every path is attempt-limited.
#[tauri::command]
pub async fn vault_unlock(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;
    let v2 = super::vault::Vault::exists(&dir);
    if !v2 && !VaultStore::exists(&dir) {
        return Err("no vault found".to_string());
    }

    // Attempt limiting: refused before the Argon2 work while a backoff is owed.
    super::throttle::check(&dir)?;
    let wrong = |dir: &std::path::Path| {
        let log = super::throttle::record_failure(dir);
        let wait = super::throttle::delay_for(log.failures);
        if wait > 0 { format!("wrong passphrase — further attempts wait {wait} s") } else { "wrong passphrase".to_string() }
    };

    if v2 {
        let v = super::vault::Vault::load(&dir)?;
        let dek = match v.unlock(&super::overseer::PassphraseOverseer::for_unlock(&passphrase)) {
            Ok(dek) => dek,
            // A tampered or rolled-back document is not a wrong passphrase; say what it is.
            Err(e) if e.contains("integrity") || e.contains("rolled back") || e.contains("unsafe") || e.contains("malformed") => return Err(e),
            Err(_) => return Err(wrong(&dir)),
        };
        super::throttle::record_success(&dir);
        state.inner.lock().map_err(|_| "vault state poisoned")?.unlock_v2(v, dek, dir);
        return Ok(serde_json::json!({ "ok": true, "unlocked": true, "format": "bankon-vault/2" }));
    }

    if !VaultStore::verify_passphrase(&dir, passphrase.as_bytes())? {
        return Err(wrong(&dir));
    }
    super::throttle::record_success(&dir);

    let params = super::kdf::calibrate(750);
    let overseer = super::overseer::PassphraseOverseer::new(&passphrase, "primary", params)
        .unwrap_or_else(|_| super::overseer::PassphraseOverseer::for_unlock(&passphrase));
    let v = super::vault::migrate_v1(&dir, &passphrase, &overseer)?;
    let dek = v.unlock(&overseer)?;
    let migrated = v.entry_count();
    state.inner.lock().map_err(|_| "vault state poisoned")?.unlock_v2(v, dek, dir);

    Ok(serde_json::json!({ "ok": true, "unlocked": true, "format": "bankon-vault/2", "migrated": migrated }))
}

/// Remove the `bankon-vault/1` files a migration left behind.
///
/// Only with the v2 vault open (so it is known to work) and the passphrase checked again.
/// Until then the v1 copy keeps its weaker protection on disk (19 MiB Argon2id, a
/// verification token, a plaintext account list).
#[tauri::command]
pub async fn vault_remove_v1_files(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;
    {
        let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
        if guard.v2().is_none() {
            return Err("open the bankon-vault/2 vault first".to_string());
        }
    }
    if !VaultStore::has_any_artefact(&dir) {
        return Ok(serde_json::json!({ "ok": true, "removed": false }));
    }
    super::throttle::check(&dir)?;
    let matches = state.inner.lock().map_err(|_| "vault state poisoned")?.passphrase_matches(&passphrase)?;
    if !matches {
        let log = super::throttle::record_failure(&dir);
        let wait = super::throttle::delay_for(log.failures);
        return Err(if wait > 0 { format!("wrong passphrase — further attempts wait {wait} s") } else { "wrong passphrase".to_string() });
    }
    super::throttle::record_success(&dir);
    VaultStore::remove_v1_files(&dir)?;
    Ok(serde_json::json!({ "ok": true, "removed": true }))
}

/// Lock the vault — clears session key from memory
#[tauri::command]
pub fn vault_lock(
    state: tauri::State<'_, VaultState>,
    approvals: tauri::State<'_, super::approval::ApprovalState>,
) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.lock();
    // Locking ends every approval and the payment allowance with the session.
    if let Ok(mut a) = approvals.inner.lock() {
        *a = super::approval::Approvals::default();
    }
    Ok(serde_json::json!({ "ok": true, "unlocked": false }))
}

/// Store a secret (mnemonic/key) for an account
#[tauri::command]
pub fn vault_store_key(
    state: tauri::State<'_, VaultState>,
    address: String,
    chain: String,
    label: String,
    secret: String,
) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.store_by_address(&chain, &address, &label, secret.as_bytes())?;

    Ok(serde_json::json!({ "ok": true, "address": address }))
}

#[derive(Debug, serde::Deserialize)]
pub struct ExportArgs {
    pub address: String,
    pub passphrase: String,
    /// The address, typed by the person — not filled in by the app.
    pub confirm: String,
}

/// Export a secret for backup — the only command that returns one.
///
/// Signing never needs this: every Keycore signer reads the key itself. An export needs an
/// unlocked vault, the passphrase again (checked under the same attempt limiter as unlock)
/// and the address typed back as confirmation.
#[tauri::command]
pub fn vault_export_secret(
    state: tauri::State<'_, VaultState>,
    args: ExportArgs,
) -> Result<serde_json::Value, String> {
    if args.confirm.trim() != args.address {
        return Err("type the address being exported to confirm".to_string());
    }
    // The directory of the open session; the lock is not held through the Argon2 check.
    let dir = {
        let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
        if !guard.is_unlocked() {
            return Err("vault is locked".to_string());
        }
        guard.dir().ok_or("vault is locked")?.to_path_buf()
    };
    super::throttle::check(&dir)?;
    let matches = state.inner.lock().map_err(|_| "vault state poisoned")?.passphrase_matches(&args.passphrase)?;
    if !matches {
        let log = super::throttle::record_failure(&dir);
        let wait = super::throttle::delay_for(log.failures);
        return Err(if wait > 0 {
            format!("wrong passphrase — further attempts wait {wait} s")
        } else {
            "wrong passphrase".to_string()
        });
    }
    super::throttle::record_success(&dir);

    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let open = guard.dir().ok_or("vault is locked")?;
    if open != dir.as_path() {
        return Err("the open vault changed during the export; nothing was exported".to_string());
    }
    let chain = guard.chain_of(&args.address)?.ok_or("no account with that address in this vault")?;
    let stored = guard.retrieve_by_address(&args.address)?;
    let secret = std::str::from_utf8(stored.as_slice()).map_err(|_| "stored secret is not valid utf-8")?;
    Ok(serde_json::json!({ "secret": secret, "chain": chain }))
}

/// The backup phrase of an account the Keycore created this session — once.
///
/// The backup step right after creation, so a new wallet can be written down without the
/// passphrase being asked again. Only for an address `store_new` stored (a Keycore-generated
/// key nobody has funded yet), once, within ten minutes, before lock; anything else must use
/// `vault_export_secret`.
#[tauri::command]
pub fn vault_reveal_new(
    state: tauri::State<'_, VaultState>,
    address: String,
) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    if !guard.take_fresh(&address) {
        return Err("only a key the Keycore just created can be shown this way, once; use the export".to_string());
    }
    let chain = guard.chain_of(&address)?.ok_or("no account with that address in this vault")?;
    let secret = guard.retrieve_by_address(&address)?;
    let text = std::str::from_utf8(secret.as_slice()).map_err(|_| "stored secret is not valid utf-8")?;
    Ok(serde_json::json!({ "secret": text, "chain": chain }))
}

/// Remove an account from the vault
#[tauri::command]
pub fn vault_remove_account(
    state: tauri::State<'_, VaultState>,
    address: String,
) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    // Unlocked, not merely "a directory was once opened": removing a key needs the session.
    guard.remove_by_address(&address)?;

    Ok(serde_json::json!({ "ok": true }))
}

/// List accounts in the vault (no secrets exposed)
#[tauri::command]
pub fn vault_list_accounts(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<AccountEntry>, String> {
    {
        let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
        if guard.v2().is_some() {
            return Ok(guard
                .accounts()?
                .into_iter()
                .map(|(address, chain, label, created_at)| AccountEntry { address, chain, label, created_at })
                .collect());
        }
    }
    let dir = vault_dir(&app)?;
    if !VaultStore::exists(&dir) {
        return Ok(vec![]);
    }

    let manifest = VaultStore::read_manifest(&dir)?;
    Ok(manifest.accounts)
}

/// Destroy the vault entirely — requires confirmation via passphrase
#[tauri::command]
pub fn vault_destroy(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;

    let v2 = super::vault::Vault::exists(&dir);
    if !v2 && !VaultStore::exists(&dir) {
        return Err("no vault to destroy".to_string());
    }

    super::throttle::check(&dir)?;
    let valid = if v2 {
        super::vault::Vault::load(&dir)?
            .unlock(&super::overseer::PassphraseOverseer::for_unlock(&passphrase))
            .is_ok()
    } else {
        VaultStore::verify_passphrase(&dir, passphrase.as_bytes())?
    };
    if !valid {
        super::throttle::record_failure(&dir);
        return Err("wrong passphrase — vault destruction requires verification".to_string());
    }

    // Lock session first
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.lock();

    VaultStore::destroy(&dir)?;

    Ok(serde_json::json!({ "ok": true, "destroyed": true }))
}
