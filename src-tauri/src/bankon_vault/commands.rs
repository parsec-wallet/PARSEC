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

    let accounts: Vec<serde_json::Value> = if exists {
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

/// Create a new vault with a passphrase
#[tauri::command]
pub fn vault_create(
    app: AppHandle,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    if passphrase.len() < 8 {
        return Err("passphrase must be at least 8 characters".to_string());
    }

    let dir = vault_dir(&app)?;
    // Any trace of a vault — a manifest, a verify token or a single key file — means one is
    // here, perhaps damaged. Writing a fresh salt over it would orphan every key it holds.
    if VaultStore::has_any_artefact(&dir) {
        return Err("a vault (or part of one) already exists here; it was not overwritten".to_string());
    }

    VaultStore::create(&dir, passphrase.as_bytes())?;

    Ok(serde_json::json!({ "ok": true }))
}

/// Unlock the vault — verifies passphrase, starts session
#[tauri::command]
pub fn vault_unlock(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;

    if !VaultStore::exists(&dir) {
        return Err("no vault found".to_string());
    }

    // Attempt limiting: refused before the Argon2 work while a backoff is owed.
    super::throttle::check(&dir)?;
    let valid = VaultStore::verify_passphrase(&dir, passphrase.as_bytes())?;
    if !valid {
        let log = super::throttle::record_failure(&dir);
        let wait = super::throttle::delay_for(log.failures);
        return Err(if wait > 0 {
            format!("wrong passphrase — further attempts wait {wait} s")
        } else {
            "wrong passphrase".to_string()
        });
    }
    super::throttle::record_success(&dir);

    let session_key = VaultStore::derive_session_key(&dir, passphrase.as_bytes())?;

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.unlock(session_key, dir);

    Ok(serde_json::json!({ "ok": true, "unlocked": true }))
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
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;

    let key = guard.key().ok_or("vault is locked")?;
    let dir = guard.dir().ok_or("vault is locked")?;

    VaultStore::store_secret(dir, key, &address, &chain, &label, secret.as_bytes())?;

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
        guard.key().ok_or("vault is locked")?;
        guard.dir().ok_or("vault is locked")?.to_path_buf()
    };
    super::throttle::check(&dir)?;
    if !VaultStore::verify_passphrase(&dir, args.passphrase.as_bytes())? {
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
    let key = guard.key().ok_or("vault is locked")?;
    let open = guard.dir().ok_or("vault is locked")?;
    if open != dir.as_path() {
        return Err("the open vault changed during the export; nothing was exported".to_string());
    }
    let chain = VaultStore::read_manifest(&dir)?
        .accounts
        .into_iter()
        .find(|a| a.address == args.address)
        .map(|a| a.chain)
        .ok_or("no account with that address in this vault")?;
    let secret_bytes = VaultStore::retrieve_secret(&dir, key, &args.address)?;
    let secret = String::from_utf8(secret_bytes).map_err(|_| "stored secret is not valid utf-8")?;
    Ok(serde_json::json!({ "secret": secret, "chain": chain }))
}

/// Remove an account from the vault
#[tauri::command]
pub fn vault_remove_account(
    state: tauri::State<'_, VaultState>,
    address: String,
) -> Result<serde_json::Value, String> {
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    // Unlocked, not merely "a directory was once opened": removing a key needs the session.
    guard.key().ok_or("vault is locked")?;
    let dir = guard.dir().ok_or("vault is locked")?;

    VaultStore::remove_account(dir, &address)?;

    Ok(serde_json::json!({ "ok": true }))
}

/// List accounts in the vault (no secrets exposed)
#[tauri::command]
pub fn vault_list_accounts(
    app: AppHandle,
) -> Result<Vec<AccountEntry>, String> {
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

    if !VaultStore::exists(&dir) {
        return Err("no vault to destroy".to_string());
    }

    super::throttle::check(&dir)?;
    let valid = VaultStore::verify_passphrase(&dir, passphrase.as_bytes())?;
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
