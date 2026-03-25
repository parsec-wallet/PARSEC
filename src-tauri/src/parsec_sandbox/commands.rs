//! Tauri IPC commands for parsec_sandbox
//!
//! Exposes the dApp filesystem permission system to the frontend.
//! The participant ALWAYS chooses. No silent escalation.

use tauri::State;

use super::{
    level_capabilities, AccessDecision, AuditEntry, DappPermission, LevelCapabilities,
    SandboxState,
};

/// Initialize the sandbox engine
#[tauri::command]
pub async fn sandbox_init(
    state: State<'_, SandboxState>,
    app_data_dir: String,
) -> Result<(), String> {
    let mut engine = state.inner.write().await;
    engine
        .init(std::path::Path::new(&app_data_dir))
        .map_err(|e| e.to_string())
}

/// Get capabilities for a given access level (for displaying to user before grant)
#[tauri::command]
pub async fn sandbox_level_info(level: u8) -> Result<LevelCapabilities, String> {
    Ok(level_capabilities(level))
}

/// Get capabilities for ALL levels (for the permission slider UI)
#[tauri::command]
pub async fn sandbox_all_levels() -> Result<Vec<LevelCapabilities>, String> {
    Ok((1..=10).map(level_capabilities).collect())
}

/// Grant filesystem access to a dApp at a user-chosen level
#[tauri::command]
pub async fn sandbox_grant(
    state: State<'_, SandboxState>,
    dapp_id: String,
    dapp_name: String,
    dapp_origin: String,
    access_level: u8,
    granted_by: String,
    expires_at: Option<u64>,
) -> Result<DappPermission, String> {
    let mut engine = state.inner.write().await;
    engine.grant(
        &dapp_id,
        &dapp_name,
        &dapp_origin,
        access_level,
        &granted_by,
        expires_at,
    )
}

/// Revoke filesystem access for a dApp
#[tauri::command]
pub async fn sandbox_revoke(
    state: State<'_, SandboxState>,
    dapp_id: String,
) -> Result<bool, String> {
    let mut engine = state.inner.write().await;
    Ok(engine.revoke(&dapp_id))
}

/// Update the access level for a dApp (user slides the 1-10 scale)
#[tauri::command]
pub async fn sandbox_update_level(
    state: State<'_, SandboxState>,
    dapp_id: String,
    new_level: u8,
) -> Result<DappPermission, String> {
    let mut engine = state.inner.write().await;
    engine.update_level(&dapp_id, new_level)
}

/// Check if a dApp can perform a specific action
#[tauri::command]
pub async fn sandbox_check(
    state: State<'_, SandboxState>,
    dapp_id: String,
    action: String,
    path: Option<String>,
    bytes: Option<u64>,
) -> Result<AccessDecision, String> {
    let engine = state.inner.read().await;
    Ok(engine.check_access(&dapp_id, &action, path.as_deref(), bytes))
}

/// Get the current permission for a dApp
#[tauri::command]
pub async fn sandbox_get_permission(
    state: State<'_, SandboxState>,
    dapp_id: String,
) -> Result<Option<DappPermission>, String> {
    let engine = state.inner.read().await;
    Ok(engine.permissions.get(&dapp_id).cloned())
}

/// List all dApp permissions
#[tauri::command]
pub async fn sandbox_list_permissions(
    state: State<'_, SandboxState>,
) -> Result<Vec<DappPermission>, String> {
    let engine = state.inner.read().await;
    Ok(engine.permissions.values().cloned().collect())
}

/// Get the audit log (recent entries)
#[tauri::command]
pub async fn sandbox_audit_log(
    state: State<'_, SandboxState>,
    limit: Option<usize>,
) -> Result<Vec<AuditEntry>, String> {
    let engine = state.inner.read().await;
    let limit = limit.unwrap_or(100);
    let start = engine.audit_log.len().saturating_sub(limit);
    Ok(engine.audit_log[start..].to_vec())
}

/// Get the sandboxed path for a dApp (so frontend can display it)
#[tauri::command]
pub async fn sandbox_dapp_path(
    state: State<'_, SandboxState>,
    dapp_id: String,
) -> Result<Option<String>, String> {
    let engine = state.inner.read().await;
    Ok(engine.dapp_dir(&dapp_id).map(|p| p.to_string_lossy().into_owned()))
}
