//! parsec_sandbox — dApp filesystem access control with participant choice
//!
//! Every dApp that connects to PARSEC must request filesystem access.
//! The user grants access on a 1-10 scale:
//!
//! Level 1:  No filesystem access. dApp can only call contract methods.
//! Level 2:  Read own sandboxed directory only (dapp-specific data).
//! Level 3:  Read own sandbox + write to own sandbox (up to 10MB).
//! Level 4:  Read own sandbox + write up to 100MB.
//! Level 5:  Read own sandbox + shared read-only directory (cross-dapp).
//! Level 6:  Read/write own sandbox + shared read access + IPFS get.
//! Level 7:  Level 6 + IPFS pin (up to storage budget).
//! Level 8:  Level 7 + read user-selected files (via dialog).
//! Level 9:  Level 8 + write user-selected files (via dialog).
//! Level 10: Full sandboxed access (all above + peer relay + search index).
//!
//! The participant ALWAYS chooses. There is no silent escalation.
//! All access is logged and auditable.

pub mod commands;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Sandbox state managed by Tauri
pub struct SandboxState {
    pub inner: Arc<RwLock<SandboxEngine>>,
}

impl Default for SandboxState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(SandboxEngine::default())),
        }
    }
}

/// The sandbox engine managing all dApp permissions
#[derive(Default)]
pub struct SandboxEngine {
    /// Per-dApp permissions (keyed by dapp_id)
    pub permissions: HashMap<String, DappPermission>,
    /// Base directory for all sandboxed data
    pub sandbox_root: Option<PathBuf>,
    /// Shared read-only directory path
    pub shared_dir: Option<PathBuf>,
    /// Audit log
    pub audit_log: Vec<AuditEntry>,
}

/// Permission grant for a specific dApp
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DappPermission {
    pub dapp_id: String,
    pub dapp_name: String,
    pub dapp_origin: String,
    /// The user-chosen access level (1-10)
    pub access_level: u8,
    /// Account that granted the permission
    pub granted_by: String,
    /// When the permission was granted
    pub granted_at: u64,
    /// Optional expiry timestamp
    pub expires_at: Option<u64>,
    /// Maximum storage quota in bytes for this dApp
    pub storage_quota: u64,
    /// Current storage usage in bytes
    pub storage_used: u64,
    /// Whether the permission has been revoked
    pub revoked: bool,
}

/// An audit log entry for filesystem access
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub dapp_id: String,
    pub action: String,
    pub path: Option<String>,
    pub bytes: Option<u64>,
    pub allowed: bool,
    pub level_required: u8,
    pub level_granted: u8,
    pub timestamp: u64,
}

/// Result of a filesystem access check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessDecision {
    pub allowed: bool,
    pub reason: String,
    pub required_level: u8,
    pub current_level: u8,
    pub storage_remaining: Option<u64>,
}

/// Capabilities granted at each access level
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LevelCapabilities {
    pub level: u8,
    pub description: String,
    pub can_read_sandbox: bool,
    pub can_write_sandbox: bool,
    pub max_write_bytes: u64,
    pub can_read_shared: bool,
    pub can_ipfs_get: bool,
    pub can_ipfs_pin: bool,
    pub can_read_user_files: bool,
    pub can_write_user_files: bool,
    pub can_peer_relay: bool,
    pub can_search_index: bool,
}

/// Get the capabilities for a given access level
pub fn level_capabilities(level: u8) -> LevelCapabilities {
    let level = level.clamp(1, 10);
    LevelCapabilities {
        level,
        description: level_description(level),
        can_read_sandbox: level >= 2,
        can_write_sandbox: level >= 3,
        max_write_bytes: match level {
            1..=2 => 0,
            3 => 10_485_760,         // 10 MB
            4 => 104_857_600,        // 100 MB
            5..=6 => 104_857_600,    // 100 MB
            7..=8 => 536_870_912,    // 512 MB
            9..=10 => 1_073_741_824, // 1 GB
            _ => 0,
        },
        can_read_shared: level >= 5,
        can_ipfs_get: level >= 6,
        can_ipfs_pin: level >= 7,
        can_read_user_files: level >= 8,
        can_write_user_files: level >= 9,
        can_peer_relay: level >= 10,
        can_search_index: level >= 10,
    }
}

fn level_description(level: u8) -> String {
    match level {
        1 => "Contract-only: no filesystem access".into(),
        2 => "Read own sandbox only".into(),
        3 => "Read/write own sandbox (10MB limit)".into(),
        4 => "Read/write own sandbox (100MB limit)".into(),
        5 => "Own sandbox + shared read access".into(),
        6 => "Own sandbox + shared read + IPFS get".into(),
        7 => "Level 6 + IPFS pin within storage budget".into(),
        8 => "Level 7 + read user-selected files".into(),
        9 => "Level 8 + write user-selected files".into(),
        10 => "Full sandboxed: all above + peer relay + search".into(),
        _ => "Unknown level".into(),
    }
}

impl SandboxEngine {
    /// Initialize sandbox directories
    pub fn init(&mut self, app_data_dir: &Path) -> std::io::Result<()> {
        let sandbox_root = app_data_dir.join("dapp_sandbox");
        let shared_dir = sandbox_root.join("_shared");

        std::fs::create_dir_all(&sandbox_root)?;
        std::fs::create_dir_all(&shared_dir)?;

        self.sandbox_root = Some(sandbox_root);
        self.shared_dir = Some(shared_dir);
        Ok(())
    }

    /// Get the sandboxed directory for a specific dApp
    pub fn dapp_dir(&self, dapp_id: &str) -> Option<PathBuf> {
        self.sandbox_root.as_ref().map(|root| {
            // Sanitize dapp_id to prevent path traversal
            let safe_id = dapp_id
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .collect::<String>();
            root.join(&safe_id)
        })
    }

    /// Check if a dApp can perform a specific action
    pub fn check_access(
        &self,
        dapp_id: &str,
        action: &str,
        path: Option<&str>,
        bytes: Option<u64>,
    ) -> AccessDecision {
        let perm = match self.permissions.get(dapp_id) {
            Some(p) if !p.revoked => p,
            Some(_) => {
                return AccessDecision {
                    allowed: false,
                    reason: "Permission revoked".into(),
                    required_level: 0,
                    current_level: 0,
                    storage_remaining: None,
                }
            }
            None => {
                return AccessDecision {
                    allowed: false,
                    reason: "No permission granted — dApp must request access".into(),
                    required_level: 0,
                    current_level: 0,
                    storage_remaining: None,
                }
            }
        };

        // Check expiry
        if let Some(expires) = perm.expires_at {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if now > expires {
                return AccessDecision {
                    allowed: false,
                    reason: "Permission expired".into(),
                    required_level: 0,
                    current_level: perm.access_level,
                    storage_remaining: None,
                };
            }
        }

        let caps = level_capabilities(perm.access_level);
        let required = required_level_for_action(action);

        if perm.access_level < required {
            return AccessDecision {
                allowed: false,
                reason: format!(
                    "Action '{}' requires level {}, dApp has level {}",
                    action, required, perm.access_level
                ),
                required_level: required,
                current_level: perm.access_level,
                storage_remaining: Some(perm.storage_quota.saturating_sub(perm.storage_used)),
            };
        }

        // Check storage quota for writes
        if action == "write" || action == "ipfs_pin" {
            if let Some(b) = bytes {
                let remaining = perm.storage_quota.saturating_sub(perm.storage_used);
                if b > remaining {
                    return AccessDecision {
                        allowed: false,
                        reason: format!(
                            "Storage quota exceeded: {} bytes requested, {} remaining",
                            b, remaining
                        ),
                        required_level: required,
                        current_level: perm.access_level,
                        storage_remaining: Some(remaining),
                    };
                }
                if b > caps.max_write_bytes {
                    return AccessDecision {
                        allowed: false,
                        reason: format!(
                            "Write exceeds level {} limit of {} bytes",
                            perm.access_level, caps.max_write_bytes
                        ),
                        required_level: required,
                        current_level: perm.access_level,
                        storage_remaining: Some(remaining),
                    };
                }
            }
        }

        // Path traversal check
        if let Some(p) = path {
            if p.contains("..") || p.starts_with('/') {
                return AccessDecision {
                    allowed: false,
                    reason: "Path traversal denied".into(),
                    required_level: required,
                    current_level: perm.access_level,
                    storage_remaining: None,
                };
            }
        }

        AccessDecision {
            allowed: true,
            reason: "Access granted".into(),
            required_level: required,
            current_level: perm.access_level,
            storage_remaining: Some(perm.storage_quota.saturating_sub(perm.storage_used)),
        }
    }

    /// Grant permission to a dApp
    pub fn grant(
        &mut self,
        dapp_id: &str,
        dapp_name: &str,
        dapp_origin: &str,
        access_level: u8,
        granted_by: &str,
        expires_at: Option<u64>,
    ) -> Result<DappPermission, String> {
        let level = access_level.clamp(1, 10);
        let caps = level_capabilities(level);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let perm = DappPermission {
            dapp_id: dapp_id.into(),
            dapp_name: dapp_name.into(),
            dapp_origin: dapp_origin.into(),
            access_level: level,
            granted_by: granted_by.into(),
            granted_at: now,
            expires_at,
            storage_quota: caps.max_write_bytes,
            storage_used: 0,
            revoked: false,
        };

        // Create the sandbox directory for this dApp
        if level >= 2 {
            if let Some(dir) = self.dapp_dir(dapp_id) {
                let _ = std::fs::create_dir_all(&dir);
            }
        }

        self.permissions.insert(dapp_id.into(), perm.clone());

        self.audit_log.push(AuditEntry {
            dapp_id: dapp_id.into(),
            action: "grant".into(),
            path: None,
            bytes: None,
            allowed: true,
            level_required: 0,
            level_granted: level,
            timestamp: now,
        });

        Ok(perm)
    }

    /// Revoke permission from a dApp
    pub fn revoke(&mut self, dapp_id: &str) -> bool {
        if let Some(perm) = self.permissions.get_mut(dapp_id) {
            perm.revoked = true;

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            self.audit_log.push(AuditEntry {
                dapp_id: dapp_id.into(),
                action: "revoke".into(),
                path: None,
                bytes: None,
                allowed: true,
                level_required: 0,
                level_granted: 0,
                timestamp: now,
            });

            true
        } else {
            false
        }
    }

    /// Update the access level for a dApp
    pub fn update_level(&mut self, dapp_id: &str, new_level: u8) -> Result<DappPermission, String> {
        let level = new_level.clamp(1, 10);
        let perm = self
            .permissions
            .get_mut(dapp_id)
            .ok_or("dApp not found")?;

        let caps = level_capabilities(level);
        perm.access_level = level;
        perm.storage_quota = caps.max_write_bytes;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        self.audit_log.push(AuditEntry {
            dapp_id: dapp_id.into(),
            action: "update_level".into(),
            path: None,
            bytes: None,
            allowed: true,
            level_required: 0,
            level_granted: level,
            timestamp: now,
        });

        Ok(perm.clone())
    }
}

/// Map an action string to the minimum required access level
fn required_level_for_action(action: &str) -> u8 {
    match action {
        "contract_call" => 1,
        "read_sandbox" => 2,
        "write_sandbox" => 3,
        "read_shared" => 5,
        "ipfs_get" => 6,
        "ipfs_pin" => 7,
        "read_user_file" => 8,
        "write_user_file" => 9,
        "peer_relay" | "search_index" => 10,
        _ => 10, // Unknown actions require maximum permission
    }
}
