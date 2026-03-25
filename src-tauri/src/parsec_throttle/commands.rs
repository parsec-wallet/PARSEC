//! Tauri IPC commands for parsec_throttle

use tauri::State;

use super::{LimiterStats, ThrottleConfig, ThrottleDecision, ThrottleState};

/// Initialize the throttle engine with configuration
#[tauri::command]
pub async fn throttle_init(
    state: State<'_, ThrottleState>,
    config: ThrottleConfig,
) -> Result<(), String> {
    let mut engine = state.inner.write().await;
    engine.config = config;
    engine.init_global();
    Ok(())
}

/// Check if a request from a source should be allowed
#[tauri::command]
pub async fn throttle_check(
    state: State<'_, ThrottleState>,
    source_id: String,
    bytes: Option<u64>,
) -> Result<ThrottleDecision, String> {
    let mut engine = state.inner.write().await;
    Ok(engine.check_request(&source_id, bytes))
}

/// Get stats for all rate limiters
#[tauri::command]
pub async fn throttle_stats(
    state: State<'_, ThrottleState>,
) -> Result<Vec<LimiterStats>, String> {
    let engine = state.inner.read().await;
    Ok(engine.all_stats())
}

/// Update throttle configuration
#[tauri::command]
pub async fn throttle_update_config(
    state: State<'_, ThrottleState>,
    config: ThrottleConfig,
) -> Result<(), String> {
    let mut engine = state.inner.write().await;
    engine.config = config;
    engine.init_global();
    Ok(())
}

/// Reset a specific source's rate limiter
#[tauri::command]
pub async fn throttle_reset_source(
    state: State<'_, ThrottleState>,
    source_id: String,
) -> Result<(), String> {
    let mut engine = state.inner.write().await;
    engine.limiters.remove(&source_id);
    Ok(())
}

/// Reset all rate limiters
#[tauri::command]
pub async fn throttle_reset_all(
    state: State<'_, ThrottleState>,
) -> Result<(), String> {
    let mut engine = state.inner.write().await;
    engine.limiters.clear();
    engine.init_global();
    Ok(())
}
