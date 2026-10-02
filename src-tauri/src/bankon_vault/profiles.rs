// bankon_vault::profiles — several vaults on one device, one open at a time.
//
// A profile is a named vault directory plus the wallets kept in it. The
// profile named `default` is the original location, `app_data_dir/bankon_vault`,
// so a vault created before profiles existed is the default profile, unmoved
// and unchanged. Every other profile lives at `app_data_dir/vaults/<name>`.
//
// The active profile is recorded in `app_data_dir/vault-profile`. Choosing a
// profile locks the open session first: a session key belongs to the vault it
// was derived from and must never be applied to another one.
//
// Nothing here deletes a vault. A forgotten passphrase is answered by making a
// new profile next to the old one, which stays where it is.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::store::VaultStore;
use super::VaultState;

pub const DEFAULT_PROFILE: &str = "default";
const ACTIVE_FILE: &str = "vault-profile";
const PROFILES_DIR: &str = "vaults";
const LEGACY_DIR: &str = "bankon_vault";
const MAX_NAME: usize = 32;

/// A profile name is also a directory name: lowercase letters, digits, `-` and
/// `_`, starting with a letter or digit, at most 32 characters.
pub fn valid_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_NAME
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-' || *b == b'_')
}

/// Where a profile's vault lives, under the app data directory `base`.
pub fn dir_for(base: &Path, name: &str) -> PathBuf {
    if name == DEFAULT_PROFILE {
        base.join(LEGACY_DIR)
    } else {
        base.join(PROFILES_DIR).join(name)
    }
}

/// The recorded active profile; `default` when none is recorded or the record
/// is unreadable.
pub fn active_in(base: &Path) -> String {
    fs::read_to_string(base.join(ACTIVE_FILE))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| valid_name(s))
        .unwrap_or_else(|| DEFAULT_PROFILE.to_string())
}

/// Every profile with a vault on disk, plus `default` and the active one.
pub fn names_in(base: &Path) -> Vec<String> {
    let mut names = vec![DEFAULT_PROFILE.to_string()];
    if let Ok(entries) = fs::read_dir(base.join(PROFILES_DIR)) {
        let mut found: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| valid_name(n) && n != DEFAULT_PROFILE)
            .collect();
        found.sort();
        names.extend(found);
    }
    let active = active_in(base);
    if !names.contains(&active) {
        names.push(active);
    }
    names
}

fn app_base(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))
}

/// The active profile's vault directory — what every v1 vault command opens.
pub fn active_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app_base(app)?;
    let name = active_in(&base);
    Ok(dir_for(&base, &name))
}

fn describe(base: &Path, name: &str) -> serde_json::Value {
    let dir = dir_for(base, name);
    // A v2 vault keeps its account list encrypted, so a locked one lists none here.
    let exists = VaultStore::exists(&dir) || super::vault::Vault::exists(&dir);
    let accounts: Vec<serde_json::Value> = if VaultStore::exists(&dir) {
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
    serde_json::json!({ "name": name, "exists": exists, "accounts": accounts })
}

/// List profiles: name, whether its vault exists, and the public addresses it
/// holds (read from the manifest — no passphrase needed, no secret returned).
#[tauri::command]
pub fn vault_profiles(app: AppHandle) -> Result<serde_json::Value, String> {
    let base = app_base(&app)?;
    let active = active_in(&base);
    let profiles: Vec<serde_json::Value> =
        names_in(&base).iter().map(|n| describe(&base, n)).collect();
    Ok(serde_json::json!({ "active": active, "profiles": profiles }))
}

/// Make `name` the active profile. Locks any open session first. The profile
/// need not have a vault yet: `vault_create` then creates it in that profile.
#[tauri::command]
pub fn vault_profile_select(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    name: String,
) -> Result<serde_json::Value, String> {
    if !valid_name(&name) {
        return Err(
            "profile names use lowercase letters, digits, - and _ (at most 32 characters)"
                .to_string(),
        );
    }
    let base = app_base(&app)?;
    {
        let mut guard = state.inner.lock().map_err(|_| "vault state poisoned")?;
        guard.lock();
    }
    fs::create_dir_all(&base).map_err(|e| format!("failed to create app data dir: {e}"))?;
    let tmp = base.join(format!("{ACTIVE_FILE}.tmp"));
    fs::write(&tmp, name.as_bytes()).map_err(|e| format!("failed to record profile: {e}"))?;
    fs::rename(&tmp, base.join(ACTIVE_FILE))
        .map_err(|e| format!("failed to record profile: {e}"))?;
    Ok(describe(&base, &name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(valid_name("default"));
        assert!(valid_name("agents-2"));
        assert!(valid_name("a"));
        assert!(!valid_name(""));
        assert!(!valid_name("-lead"));
        assert!(!valid_name("Upper"));
        assert!(!valid_name("../x"));
        assert!(!valid_name("a/b"));
        assert!(!valid_name(&"a".repeat(33)));
    }

    #[test]
    fn default_profile_is_the_original_vault() {
        let base = Path::new("/data");
        assert_eq!(dir_for(base, "default"), base.join("bankon_vault"));
        assert_eq!(dir_for(base, "work"), base.join("vaults").join("work"));
    }

    #[test]
    fn active_and_listing() {
        let base = std::env::temp_dir().join(format!("pv-profiles-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("vaults").join("work")).unwrap();
        fs::create_dir_all(base.join("vaults").join("Bad Name")).unwrap();
        assert_eq!(active_in(&base), "default");
        fs::write(base.join("vault-profile"), "fresh\n").unwrap();
        assert_eq!(active_in(&base), "fresh");
        assert_eq!(names_in(&base), vec!["default", "work", "fresh"]);
        fs::write(base.join("vault-profile"), "../escape").unwrap();
        assert_eq!(active_in(&base), "default");
        let _ = fs::remove_dir_all(&base);
    }
}
