//! Tauri IPC commands for parsec_connect
//!
//! Exposes connect server control and sign request approval to the frontend.

use std::sync::Arc;
use tauri::State;

use super::server;
use super::{ConnectState, DappSession, SignRequest, SignResponse};

/// Start the connect server on the specified port
#[tauri::command]
pub async fn connect_start(
    state: State<'_, ConnectState>,
    app_handle: tauri::AppHandle,
    port: Option<u16>,
    allowed_origins: Option<Vec<String>>,
    active_address: Option<String>,
) -> Result<String, String> {
    // On a phone, loopback is shared by every installed app: the bridge's defence (only
    // this machine reaches 127.0.0.1, threat model A5) does not hold there. Refuse.
    if cfg!(target_os = "android") || cfg!(target_os = "ios") {
        let _ = (&state, &app_handle, &port, &allowed_origins, &active_address);
        return Err("the dApp bridge is not available on a phone: other apps share its loopback".into());
    }
    let port = port.unwrap_or(9876);
    let origins = allowed_origins.unwrap_or_else(|| {
        vec!["https://agenticplace.pythai.net".into()]
    });

    let mut sess = state.inner.write().await;
    if sess.server_running {
        return Err("Connect server already running".into());
    }

    sess.port = port;
    sess.allowed_origins = origins.clone();
    sess.server_running = true;

    let session = state.inner.clone();

    // Shared state for the server
    let active_addr = Arc::new(tokio::sync::RwLock::new(active_address));
    let wallet_unlocked = Arc::new(tokio::sync::RwLock::new(true));
    let network = Arc::new(tokio::sync::RwLock::new("mainnet".to_string()));

    drop(sess);

    let port_copy = port;
    tokio::spawn(async move {
        if let Err(e) = server::start_connect_server(
            port_copy,
            session,
            active_addr,
            wallet_unlocked,
            network,
            origins,
            Some(app_handle),
        )
        .await
        {
            eprintln!("Connect server error: {}", e);
        }
    });

    Ok(format!("Connect server listening on localhost:{}", port))
}

/// Stop the connect server
#[tauri::command]
pub async fn connect_stop(state: State<'_, ConnectState>) -> Result<(), String> {
    let mut sess = state.inner.write().await;
    sess.server_running = false;
    sess.sessions.clear();
    sess.pending_requests.clear();
    sess.response_channels.clear();
    // Note: the tokio task will exit on next connection attempt or timeout
    Ok(())
}

/// List active dApp sessions
#[tauri::command]
pub async fn connect_sessions(
    state: State<'_, ConnectState>,
) -> Result<Vec<DappSession>, String> {
    let sess = state.inner.read().await;
    Ok(sess.sessions.values().cloned().collect())
}

/// Get pending sign requests
#[tauri::command]
pub async fn connect_pending_requests(
    state: State<'_, ConnectState>,
) -> Result<Vec<SignRequest>, String> {
    let sess = state.inner.read().await;
    Ok(sess.pending_requests.values().cloned().collect())
}

/// Approve a pending sign request with signed transaction bytes
#[tauri::command]
pub async fn connect_approve_sign(
    state: State<'_, ConnectState>,
    request_id: u64,
    signed_txns_b64: Vec<String>,
) -> Result<(), String> {
    let mut sess = state.inner.write().await;
    if let Some(tx) = sess.response_channels.remove(&request_id) {
        tx.send(SignResponse::Approved { signed_txns_b64 })
            .await
            .map_err(|_| "Failed to send approval")?;
        sess.pending_requests.remove(&request_id);
        Ok(())
    } else {
        Err(format!("No pending request with id {}", request_id))
    }
}

/// Reject a pending sign request
#[tauri::command]
pub async fn connect_reject_sign(
    state: State<'_, ConnectState>,
    request_id: u64,
    reason: Option<String>,
) -> Result<(), String> {
    let mut sess = state.inner.write().await;
    if let Some(tx) = sess.response_channels.remove(&request_id) {
        tx.send(SignResponse::Rejected {
            reason: reason.unwrap_or_else(|| "User rejected".into()),
        })
        .await
        .map_err(|_| "Failed to send rejection")?;
        sess.pending_requests.remove(&request_id);
        Ok(())
    } else {
        Err(format!("No pending request with id {}", request_id))
    }
}

/// Disconnect a specific dApp session
#[tauri::command]
pub async fn connect_disconnect_session(
    state: State<'_, ConnectState>,
    session_id: String,
) -> Result<(), String> {
    let mut sess = state.inner.write().await;
    sess.sessions.remove(&session_id);
    Ok(())
}
