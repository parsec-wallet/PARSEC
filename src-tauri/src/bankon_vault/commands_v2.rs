// bankon_vault::commands_v2 — the `bankon-vault/2` IPC surface.
//
// Additive. Every v1 command in `commands.rs` keeps its name, arguments and
// return shape, because `CLAUDE.md` treats these 16 commands as a public contract
// that other projects build against. The new commands sit alongside them and the
// v1 ones are routed to the v2 vault when one exists, so an existing consumer
// gets the stronger format without changing a line.
//
// The load-bearing difference from v1: secrets cross this boundary as base64 of
// raw BYTES with an explicit scheme tag, never as `String`. v1 ran every secret
// through `String::from_utf8`, which made a Falcon-1024 private key — ~2,305
// bytes of binary — impossible to store and blocked cp4096 commitment V on a type
// signature.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use tauri::{AppHandle, Manager};

use super::format::{CustodyKind, KeyScheme};
use super::kdf::KdfParams;
use super::overseer::{Overseer, PassphraseOverseer, SignatureOverseer};
use super::secure_mem::wipe;
use super::vault::{self, Vault};
use super::VaultState;

fn vault_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    Ok(base.join("bankon_vault"))
}

/// Which vault generation is on disk, and whether a session is open.
#[tauri::command]
pub fn vault_v2_status(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;
    let guard = state.inner.lock().map_err(|_| "vault state poisoned")?;

    let v2_exists = Vault::exists(&dir);
    let v1_exists = super::store::VaultStore::exists(&dir);

    // Entry count is safe to report while locked; the roster is not, and is only
    // returned once a session holds the DEK.
    let (entries, custodians, accounts) = match guard.v2() {
        Some(s) => {
            let accounts = s.vault.list_accounts(&s.dek)?;
            (
                s.vault.entry_count(),
                s.vault
                    .custodians()
                    .into_iter()
                    .map(|(k, l)| serde_json::json!({ "kind": k.tag(), "label": l }))
                    .collect::<Vec<_>>(),
                serde_json::to_value(accounts).unwrap_or(serde_json::Value::Null),
            )
        }
        None if v2_exists => {
            let v = Vault::load(&dir)?;
            (
                v.entry_count(),
                v.custodians()
                    .into_iter()
                    .map(|(k, l)| serde_json::json!({ "kind": k.tag(), "label": l }))
                    .collect::<Vec<_>>(),
                serde_json::Value::Null,
            )
        }
        None => (0, vec![], serde_json::Value::Null),
    };

    Ok(serde_json::json!({
        "format": if v2_exists {
            serde_json::json!("bankon-vault/2")
        } else if v1_exists {
            serde_json::json!("bankon-vault/1")
        } else {
            serde_json::Value::Null
        },
        "exists": v2_exists || v1_exists,
        "needsMigration": v1_exists && !v2_exists,
        "unlocked": guard.is_unlocked(),
        "entryCount": entries,
        "custodians": custodians,
        // Null while locked — the account roster is encrypted, so a locked vault
        // discloses neither which accounts it holds nor how many.
        "accounts": accounts,
    }))
}

/// Create a new v2 vault with a passphrase custodian.
#[tauri::command]
pub fn vault_v2_create(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;
    // Calibrate to ~750 ms on this machine. Unlocking is rare and interactive;
    // every extra millisecond costs an offline attacker proportionally.
    let params = super::kdf::calibrate(750);
    let overseer = PassphraseOverseer::new(&passphrase, "primary", params)?;

    let v = Vault::create(&dir, &overseer)?;
    let dek = v.unlock(&overseer)?;
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.unlock_v2(v, dek, dir);

    Ok(serde_json::json!({
        "ok": true,
        "format": "bankon-vault/2",
        "kdf": { "m_cost": params.m_cost, "t_cost": params.t_cost, "p_cost": params.p_cost },
    }))
}

/// Unlock with a passphrase.
#[tauri::command]
pub fn vault_v2_unlock(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;
    // Refuse before doing any work if a backoff is still in force, so a caller
    // driving this in a loop cannot even spend our CPU on Argon2id.
    super::throttle::check(&dir)?;

    let v = Vault::load(&dir)?;
    let overseer = PassphraseOverseer::for_unlock(&passphrase);
    let dek = match v.unlock(&overseer) {
        Ok(dek) => {
            super::throttle::record_success(&dir);
            dek
        }
        Err(e) => {
            let log = super::throttle::record_failure(&dir);
            let wait = super::throttle::delay_for(log.failures);
            return Err(if wait > 0 {
                format!("{e} — next attempt allowed in {wait}s ({} consecutive failures)", log.failures)
            } else {
                e
            });
        }
    };

    let count = v.entry_count();
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.unlock_v2(v, dek, dir);
    Ok(serde_json::json!({ "ok": true, "unlocked": true, "entryCount": count }))
}

/// Store raw key material. `secret_b64` is base64 of the BYTES; `scheme` names
/// what they are (`falcon1024`, `ed25519`, `mnemonic-algo25`, …).
#[tauri::command]
pub fn vault_store_key_bytes(
    state: tauri::State<'_, VaultState>,
    chain: String,
    address: String,
    label: String,
    scheme: String,
    secret_b64: String,
) -> Result<serde_json::Value, String> {
    let scheme = KeyScheme::from_tag(&scheme)?;
    let mut secret = B64
        .decode(secret_b64.as_bytes())
        .map_err(|_| "secret_b64 is not valid base64".to_string())?;
    if secret.is_empty() {
        return Err("refusing to store an empty secret".to_string());
    }

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    gate_idle(&mut guard)?;
    let s = guard.v2_mut().ok_or("vault is locked")?;
    let result = s
        .vault
        .store_secret(&s.dek, &chain, &address, &label, scheme, &secret);
    // Wipe our decoded copy regardless of outcome.
    wipe(&mut secret);
    result?;

    Ok(serde_json::json!({ "ok": true, "address": address, "scheme": scheme.tag() }))
}

/// Retrieve raw key material as base64 bytes.
///
/// EXPORT PATH ONLY. Anything returned here becomes an immutable JavaScript
/// string that can never be wiped, so signing must not go through it — Phase 3
/// adds `vault_sign_*` commands that keep the secret inside Rust. Kept in the
/// contract because other projects in the family depend on it.
#[tauri::command]
pub fn vault_retrieve_key_bytes(
    state: tauri::State<'_, VaultState>,
    chain: String,
    address: String,
) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    gate_idle(&mut guard)?;
    let s = guard.v2().ok_or("vault is locked")?;
    let secret = s.vault.retrieve_secret(&s.dek, &chain, &address)?;
    let scheme = s.vault.scheme_of(&s.dek, &chain, &address)?;
    Ok(serde_json::json!({
        "secret_b64": B64.encode(secret.as_slice()),
        "scheme": scheme.tag(),
    }))
}

/// Remove an account and its key.
#[tauri::command]
pub fn vault_v2_remove_account(
    state: tauri::State<'_, VaultState>,
    chain: String,
    address: String,
) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    gate_idle(&mut guard)?;
    let s = guard.v2_mut().ok_or("vault is locked")?;
    s.vault.remove_account(&s.dek, &chain, &address)?;
    Ok(serde_json::json!({ "ok": true }))
}

/// Change the passphrase. One 32-byte rewrap — no entry is re-encrypted.
#[tauri::command]
pub fn vault_change_passphrase(
    state: tauri::State<'_, VaultState>,
    current: String,
    new_passphrase: String,
) -> Result<serde_json::Value, String> {
    let params = super::kdf::calibrate(750);
    let new_overseer = PassphraseOverseer::new(&new_passphrase, "primary", params)?;

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    gate_idle(&mut guard)?;
    let s = guard.v2_mut().ok_or("vault is locked")?;

    // Re-prove the current passphrase even though a session is already open, so
    // an unattended unlocked wallet cannot have its passphrase silently replaced.
    let current_overseer = PassphraseOverseer::for_unlock(&current);
    s.vault
        .unlock(&current_overseer)
        .map_err(|_| "current passphrase is incorrect".to_string())?;

    s.vault
        .change_passphrase(&s.dek, "primary", &new_overseer)?;
    Ok(serde_json::json!({ "ok": true }))
}

/// Bind a participant wallet signature as an additional custodian.
///
/// The signature must be over `overseer::binding_message(vault_id, address)` and must come from a
/// deterministic scheme (Ed25519, or ECDSA with RFC-6979 nonces) — a wallet
/// signing with a random `k` would produce a different key every time and make
/// the vault unopenable through this custodian.
#[tauri::command]
pub fn vault_add_signature_custodian(
    state: tauri::State<'_, VaultState>,
    signature_b64: String,
    address: String,
    label: String,
) -> Result<serde_json::Value, String> {
    let mut sig = B64
        .decode(signature_b64.as_bytes())
        .map_err(|_| "signature_b64 is not valid base64".to_string())?;
    let overseer = SignatureOverseer::new(&sig, &address, &label);
    wipe(&mut sig);
    let overseer = overseer?;

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    gate_idle(&mut guard)?;
    let s = guard.v2_mut().ok_or("vault is locked")?;
    s.vault.add_custodian(&s.dek, &overseer)?;
    Ok(serde_json::json!({ "ok": true, "custodians": s.vault.custodians().len() }))
}

/// Remove a custodian by kind and label. Never the last one.
#[tauri::command]
pub fn vault_remove_custodian(
    state: tauri::State<'_, VaultState>,
    kind: String,
    label: String,
) -> Result<serde_json::Value, String> {
    let kind = match kind.as_str() {
        "passphrase" => CustodyKind::Passphrase,
        "wallet-signature" => CustodyKind::WalletSignature,
        "key-file" => CustodyKind::KeyFile,
        other => return Err(format!("unknown custody kind {other:?}")),
    };
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    gate_idle(&mut guard)?;
    let s = guard.v2_mut().ok_or("vault is locked")?;
    s.vault.remove_custodian(kind, &label)?;
    Ok(serde_json::json!({ "ok": true }))
}

/// The message a participant must sign to bind a vault to their wallet key.
///
/// Exposed so the UI can display exactly what is being signed. It is deliberately
/// NOT reachable through `parsec_connect`: a signature over this string is a
/// bearer credential for the vault, so no dApp may ever be handed it to sign.
#[tauri::command]
pub fn vault_binding_message(app: AppHandle, address: String) -> Result<serde_json::Value, String> {
    let vault = super::vault::Vault::load(&vault_dir(&app)?)?;
    Ok(serde_json::json!({ "message": super::overseer::binding_message(vault.vault_id(), &address) }))
}

/// Report what a v1 → v2 migration would move, without touching anything.
#[tauri::command]
pub fn vault_migration_plan(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;
    if Vault::exists(&dir) {
        return Ok(serde_json::json!({ "needed": false, "reason": "already bankon-vault/2" }));
    }
    if !super::store::VaultStore::exists(&dir) {
        return Ok(serde_json::json!({ "needed": false, "reason": "no vault" }));
    }
    let manifest = super::store::VaultStore::read_manifest(&dir)?;
    let chains: Vec<String> = vault::v1_chains(&dir)?.into_iter().collect();
    Ok(serde_json::json!({
        "needed": true,
        "accounts": manifest.accounts.len(),
        "chains": chains,
        "from": "bankon-vault/1",
        "to": "bankon-vault/2",
    }))
}

/// Migrate a v1 vault to v2.
///
/// Non-destructive: every secret is read, re-sealed under the new format, and
/// then read back and compared before the migration is declared successful. The
/// v1 files are left in place, so a failure at any point leaves the participant's
/// keys exactly where they were.
#[tauri::command]
pub fn vault_migrate(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    let dir = vault_dir(&app)?;
    let params = super::kdf::calibrate(750);

    // Policy is not enforced on migration: the existing passphrase may predate
    // the 12-character rule, and refusing to migrate would strand the participant
    // on the weaker format — the opposite of the intent.
    let overseer = PassphraseOverseer::new(&passphrase, "primary", params)
        .unwrap_or_else(|_| PassphraseOverseer::for_unlock(&passphrase));

    let v = vault::migrate_v1(&dir, &passphrase, &overseer)?;
    let dek = v.unlock(&overseer)?;
    let count = v.entry_count();

    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.unlock_v2(v, dek, dir);

    Ok(serde_json::json!({
        "ok": true,
        "migrated": count,
        "format": "bankon-vault/2",
        "note": "bankon-vault/1 files were left in place; remove them once you have verified access",
    }))
}

/// Report the KDF cost this machine would choose, for display before creation.
#[tauri::command]
pub fn vault_kdf_profile() -> Result<serde_json::Value, String> {
    let d = KdfParams::platform_default();
    let f = KdfParams::FLOOR;
    Ok(serde_json::json!({
        "default": { "m_cost_kib": d.m_cost, "t_cost": d.t_cost, "p_cost": d.p_cost },
        "floor":   { "m_cost_kib": f.m_cost, "t_cost": f.t_cost, "p_cost": f.p_cost },
        "algorithm": "argon2id",
    }))
}

/// Assess a passphrase. Advisory — nothing here refuses a choice.
///
/// Rust is the authority on the bands (`CLAUDE.md`: the frontend may classify and
/// suggest, the backend verifies and decides). The UI mirrors this for live
/// keystroke feedback without a round trip, and this command is what any
/// decision should actually be taken against.
#[tauri::command]
pub fn vault_passphrase_strength(passphrase: String) -> Result<serde_json::Value, String> {
    let a = super::overseer::assess(&passphrase);
    Ok(serde_json::json!({
        "strength": a.strength.tag(),
        "length": a.length,
        "warnings": a.warnings,
        "strongAt": super::overseer::STRONG_PASSPHRASE_LEN,
        "weakAtOrBelow": super::overseer::WEAK_PASSPHRASE_LEN,
    }))
}

/// Generate a 12-character passphrase mixing letters, digits and symbols.
///
/// Drawn from the OS CSPRNG with rejection sampling, one character guaranteed
/// from each class, then shuffled. Ambiguous glyphs (`l I O 0 1`) are excluded so
/// it survives being written on paper.
#[tauri::command]
pub fn vault_generate_passphrase() -> Result<serde_json::Value, String> {
    let p = super::overseer::generate_passphrase();
    let a = super::overseer::assess(&p);
    Ok(serde_json::json!({ "passphrase": p, "strength": a.strength.tag(), "length": a.length }))
}

// ── idle auto-lock ──────────────────────────────────────────────────────────

/// Enforce the idle timeout, then mark activity.
///
/// Called at the top of every operation that uses the DEK. Enforcing on access
/// rather than on a background timer means the deadline cannot be missed because
/// a timer thread was descheduled, and there is no wakeup burning battery on an
/// idle machine.
fn gate_idle(guard: &mut super::VaultSession) -> Result<(), String> {
    if guard.lock_if_idle() {
        return Err("vault locked after inactivity — unlock again".to_string());
    }
    guard.touch();
    Ok(())
}

/// Configure the idle timeout in seconds. Zero disables it.
#[tauri::command]
pub fn vault_set_auto_lock(
    state: tauri::State<'_, VaultState>,
    seconds: u64,
) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    guard.set_auto_lock_secs(seconds);
    Ok(serde_json::json!({ "ok": true, "seconds": seconds }))
}

/// Report the idle timeout and how long is left on it.
#[tauri::command]
pub fn vault_auto_lock_status(
    state: tauri::State<'_, VaultState>,
) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let locked_now = guard.lock_if_idle();
    Ok(serde_json::json!({
        "seconds": guard.auto_lock_secs(),
        "enabled": guard.auto_lock_secs() > 0,
        "remaining": guard.idle_remaining_secs(),
        "unlocked": guard.is_unlocked(),
        "justLocked": locked_now,
    }))
}

/// Heartbeat from the UI on participant activity.
///
/// Deliberately does NOT extend the deadline by itself — it enforces the timeout
/// first, so a frontend that only starts sending heartbeats after the window has
/// already passed cannot resurrect an expired session.
#[tauri::command]
pub fn vault_touch(state: tauri::State<'_, VaultState>) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
    let locked = guard.lock_if_idle();
    if !locked {
        guard.touch();
    }
    Ok(serde_json::json!({ "unlocked": guard.is_unlocked(), "justLocked": locked }))
}
