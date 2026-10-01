// bankon_vault::tomb_commands — Tauri IPC for Tomb integration
// Manages the tomb lifecycle: create, open, close, USB detection.
// Poor man's cold storage: .tomb on disk, .tomb.key on USB pen.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use super::tomb;
use super::VaultState;

const TOMB_NAME: &str = "bankon";
const TOMB_SIZE_MB: u32 = 128; // Default tomb size

fn tomb_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    Ok(base.join("tomb"))
}

fn tomb_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tomb_dir(app)?.join(format!("{TOMB_NAME}.tomb")))
}

fn tomb_mount(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tomb_dir(app)?.join("mnt"))
}

/// Check Tomb availability and system dependencies
#[tauri::command]
pub fn tomb_check() -> tomb::TombAvailability {
    tomb::check_availability()
}

/// Detect USB drives suitable for key storage (>=100MB free)
#[tauri::command]
pub fn tomb_detect_usb() -> Vec<tomb::UsbDrive> {
    tomb::detect_usb_drives()
}

/// Create a new tomb vault
/// - Creates .tomb file in app data
/// - Forges .tomb.key on specified path (USB or local)
/// - Locks the tomb with the key
#[tauri::command]
pub fn tomb_create(
    app: AppHandle,
    passphrase: String,
    key_path: String,
    size_mb: Option<u32>,
) -> Result<serde_json::Value, String> {
    let avail = tomb::check_availability();
    if !avail.available {
        return Err(format!(
            "Tomb not available. Missing: {}",
            avail.missing_deps.join(", ")
        ));
    }

    let dir = tomb_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create tomb dir: {e}"))?;

    let tomb_path = tomb_file(&app)?;
    let key = PathBuf::from(&key_path);
    let size = size_mb.unwrap_or(TOMB_SIZE_MB);

    // Step 1: Dig the tomb
    tomb::dig(&tomb_path, size)?;

    // Step 2: Forge the key (on USB or wherever specified)
    if let Some(parent) = key.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create key directory: {e}"))?;
    }
    tomb::forge(&key, &passphrase)?;

    // Step 3: Lock the tomb with the key
    tomb::lock(&tomb_path, &key, &passphrase)?;

    Ok(serde_json::json!({
        "ok": true,
        "tomb": tomb_path.to_string_lossy(),
        "key": key_path,
        "size_mb": size,
    }))
}

/// Open the tomb — mounts the encrypted volume
/// Requires key file path (USB pen) + passphrase
#[tauri::command]
pub fn tomb_open(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    passphrase: String,
    key_path: String,
) -> Result<serde_json::Value, String> {
    let tomb_path = tomb_file(&app)?;
    let mount = tomb_mount(&app)?;
    let key = PathBuf::from(&key_path);

    if !tomb_path.exists() {
        return Err("no tomb found — create one first".to_string());
    }
    if !key.exists() {
        return Err(format!(
            "key file not found at {}. Is your USB drive plugged in?",
            key_path
        ));
    }

    // Check if already open
    if tomb::is_open(TOMB_NAME) {
        // Already mounted — just update session
        // Verified like any unlock. There is no fallback: a key that is not derived from the
        // vault's own salt would encrypt new secrets under a key nothing can reproduce.
        let session_key = verified_session_key(&mount, &passphrase)?;
        let mut guard = state.inner.lock().map_err(|_| "state poisoned")?;
        guard.unlock(session_key, mount.clone());

        return Ok(serde_json::json!({
            "ok": true,
            "mount": mount.to_string_lossy(),
            "already_open": true,
        }));
    }

    tomb::open(&tomb_path, &key, &mount, &passphrase)?;

    // Initialize vault store inside tomb if not exists
    let vault_inside = mount.clone();
    if !super::store::VaultStore::has_any_artefact(&vault_inside) {
        super::store::VaultStore::create(&vault_inside, passphrase.as_bytes())?;
    } else if !super::store::VaultStore::exists(&vault_inside) {
        return Err("the vault inside the tomb is incomplete; it was left untouched".to_string());
    }

    // Unlock the vault session — verified, under the attempt limiter
    let session_key = verified_session_key(&vault_inside, &passphrase)?;
    let mut guard = state.inner.lock().map_err(|_| "state poisoned")?;
    guard.unlock(session_key, vault_inside);

    Ok(serde_json::json!({
        "ok": true,
        "mount": mount.to_string_lossy(),
    }))
}

/// Close the tomb — unmounts, vault data fully encrypted at rest
#[tauri::command]
pub fn tomb_close(
    state: tauri::State<'_, VaultState>,
) -> Result<serde_json::Value, String> {
    // Lock vault session first
    let mut guard = state.inner.lock().map_err(|_| "state poisoned")?;
    guard.lock();

    // Close the tomb
    tomb::close(TOMB_NAME).or_else(|_| tomb::close("all"))?;

    Ok(serde_json::json!({ "ok": true, "mounted": false }))
}

/// Force-close the tomb (kills processes using it)
#[tauri::command]
pub fn tomb_slam(
    state: tauri::State<'_, VaultState>,
) -> Result<serde_json::Value, String> {
    let mut guard = state.inner.lock().map_err(|_| "state poisoned")?;
    guard.lock();

    tomb::slam(TOMB_NAME).or_else(|_| tomb::slam("all"))?;

    Ok(serde_json::json!({ "ok": true, "slammed": true }))
}

/// Get tomb status — is it open? where's it mounted?
#[tauri::command]
pub fn tomb_status(
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let tomb_path = tomb_file(&app)?;
    let exists = tomb_path.exists();
    let is_open = tomb::is_open(TOMB_NAME);

    Ok(serde_json::json!({
        "exists": exists,
        "open": is_open,
        "tomb_path": tomb_path.to_string_lossy(),
    }))
}

/// The session key for the vault at `dir`, only after the passphrase verifies — with the
/// same attempt limiting as `vault_unlock`.
fn verified_session_key(dir: &std::path::Path, passphrase: &str) -> Result<Vec<u8>, String> {
    super::throttle::check(dir)?;
    if !super::store::VaultStore::verify_passphrase(dir, passphrase.as_bytes())? {
        super::throttle::record_failure(dir);
        return Err("wrong passphrase".to_string());
    }
    super::throttle::record_success(dir);
    super::store::VaultStore::derive_session_key(dir, passphrase.as_bytes())
}
