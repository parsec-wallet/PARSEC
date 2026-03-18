// bankon_vault::tomb — Tomb encrypted volume driver
// Linux-only. Wraps the Tomb CLI for LUKS-encrypted vault volumes.
// .tomb file on disk, .tomb.key on USB = poor man's cold storage.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Tomb system availability
#[derive(Debug, Clone, serde::Serialize)]
pub struct TombAvailability {
    pub available: bool,
    pub tomb_path: Option<String>,
    pub version: Option<String>,
    pub missing_deps: Vec<String>,
}

/// Check if Tomb and its dependencies are available
pub fn check_availability() -> TombAvailability {
    let tomb_path = which("tomb");
    let version = tomb_path
        .as_ref()
        .and_then(|_| run_tomb(&["-v"]).ok())
        .map(|v| v.trim().to_string());

    let mut missing = Vec::new();
    for dep in &["zsh", "cryptsetup", "gpg"] {
        if which(dep).is_none() {
            missing.push(dep.to_string());
        }
    }

    let available = tomb_path.is_some() && missing.is_empty();

    TombAvailability {
        available,
        tomb_path,
        version,
        missing_deps: missing,
    }
}

/// Detect mounted USB/removable drives — candidates for key storage
pub fn detect_usb_drives() -> Vec<UsbDrive> {
    let mut drives = Vec::new();

    // Check /media/$USER/ and /run/media/$USER/ (standard mount points)
    let user = std::env::var("USER").unwrap_or_else(|_| "root".into());
    let search_dirs = vec![
        PathBuf::from(format!("/media/{user}")),
        PathBuf::from(format!("/run/media/{user}")),
        PathBuf::from("/media"),
        PathBuf::from("/mnt"),
    ];

    for search_dir in &search_dirs {
        if let Ok(entries) = std::fs::read_dir(search_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    // Check available space
                    if let Some(info) = drive_info(&path) {
                        if info.available_mb >= 100 {
                            drives.push(info);
                        }
                    }
                }
            }
        }
    }

    // Deduplicate by mount path
    drives.sort_by(|a, b| a.mount_path.cmp(&b.mount_path));
    drives.dedup_by(|a, b| a.mount_path == b.mount_path);
    drives
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsbDrive {
    pub mount_path: String,
    pub label: String,
    pub available_mb: u64,
    pub total_mb: u64,
}

fn drive_info(path: &Path) -> Option<UsbDrive> {
    // Use statvfs via nix or fallback to df
    let output = Command::new("df")
        .args(["--output=avail,size", "-m"])
        .arg(path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().collect();
    if lines.len() < 2 {
        return None;
    }

    let parts: Vec<&str> = lines[1].split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    let available_mb = parts[0].parse::<u64>().ok()?;
    let total_mb = parts[1].parse::<u64>().ok()?;

    let label = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".into());

    Some(UsbDrive {
        mount_path: path.to_string_lossy().to_string(),
        label,
        available_mb,
        total_mb,
    })
}

// ── Tomb operations ──────────────────────────────────────────────

/// Create an empty tomb file
pub fn dig(tomb_path: &Path, size_mb: u32) -> Result<String, String> {
    run_tomb(&[
        "dig",
        "-s",
        &size_mb.to_string(),
        &tomb_path.to_string_lossy(),
        "--force",
        "--no-color",
    ])
}

/// Forge a key file (on USB or local)
pub fn forge(key_path: &Path, passphrase: &str) -> Result<String, String> {
    run_tomb(&[
        "forge",
        &key_path.to_string_lossy(),
        "--force",
        "--no-color",
        "--unsafe",
        "--tomb-pwd",
        passphrase,
        "--kdf",
        "argon2",
    ])
}

/// Lock a tomb with a key (initial encryption)
pub fn lock(tomb_path: &Path, key_path: &Path, passphrase: &str) -> Result<String, String> {
    run_tomb(&[
        "lock",
        &tomb_path.to_string_lossy(),
        "-k",
        &key_path.to_string_lossy(),
        "--no-color",
        "--unsafe",
        "--tomb-pwd",
        passphrase,
        "--force",
    ])
}

/// Open (mount) a tomb
pub fn open(
    tomb_path: &Path,
    key_path: &Path,
    mount_point: &Path,
    passphrase: &str,
) -> Result<String, String> {
    // Ensure mount point exists
    std::fs::create_dir_all(mount_point)
        .map_err(|e| format!("failed to create mount point: {e}"))?;

    run_tomb(&[
        "open",
        &tomb_path.to_string_lossy(),
        "-k",
        &key_path.to_string_lossy(),
        &mount_point.to_string_lossy(),
        "--no-color",
        "--unsafe",
        "--tomb-pwd",
        passphrase,
    ])
}

/// Close a tomb
pub fn close(tomb_name: &str) -> Result<String, String> {
    run_tomb(&["close", tomb_name, "--no-color"])
}

/// Slam (force-close) a tomb
pub fn slam(tomb_name: &str) -> Result<String, String> {
    run_tomb(&["slam", tomb_name, "--no-color"])
}

/// List open tombs
pub fn list() -> Result<String, String> {
    run_tomb(&["list", "--no-color"])
}

/// Check if a specific tomb is currently open
pub fn is_open(tomb_name: &str) -> bool {
    list()
        .map(|output| output.contains(tomb_name))
        .unwrap_or(false)
}

/// Resize a tomb
pub fn resize(
    tomb_path: &Path,
    key_path: &Path,
    new_size_mb: u32,
    passphrase: &str,
) -> Result<String, String> {
    run_tomb(&[
        "resize",
        "-s",
        &new_size_mb.to_string(),
        &tomb_path.to_string_lossy(),
        "-k",
        &key_path.to_string_lossy(),
        "--no-color",
        "--unsafe",
        "--tomb-pwd",
        passphrase,
    ])
}

// ── Helpers ──────────────────────────────────────────────────────

fn run_tomb(args: &[&str]) -> Result<String, String> {
    let output = Command::new("tomb")
        .args(args)
        .output()
        .map_err(|e| format!("failed to execute tomb: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!("{stdout}{stderr}").trim().to_string())
    }
}

fn which(cmd: &str) -> Option<String> {
    Command::new("which")
        .arg(cmd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}
