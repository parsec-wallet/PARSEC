//! WebSocket server for dApp ↔ PARSEC Wallet communication
//!
//! Runs on localhost:9876 (configurable). Web dApps connect via WebSocket
//! and exchange JSON-RPC messages for account discovery and transaction signing.
//!
//! Protocol: JSON-RPC 2.0 over WebSocket
//!
//! Methods:
//!   - parsec_accounts      → list connected accounts
//!   - parsec_signTransactions → sign txn(s) with user approval
//!   - parsec_network       → get current network info
//!   - ping                 → heartbeat (returns pong)
//!
//! Error codes:
//!   4001 — User rejected / timeout
//!   4002 — Request timeout
//!   4100 — Wallet locked or no account
//!  -32700 — Parse error
//!  -32601 — Method not found
//!  -32602 — Invalid params

use anyhow::Result;
use axum::{
    extract::{
        ws::{Message, WebSocket},
        State as AxumState, WebSocketUpgrade,
    },
    http::{header, HeaderValue, Method},
    response::{IntoResponse, Json},
    routing::get,
    Router,
};
use serde_json::json;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::sync::{mpsc, RwLock};
use tower_http::cors::{AllowOrigin, CorsLayer};

use super::{
    ConnectSession, DappSession, JsonRpcRequest, JsonRpcResponse, SignRequest, SignResponse,
};

/// Shared state for the connect server
pub struct ConnectServerState {
    pub session: Arc<RwLock<ConnectSession>>,
    /// The Algorand address currently active in the wallet
    pub active_address: Arc<RwLock<Option<String>>>,
    /// Whether the wallet is unlocked
    pub wallet_unlocked: Arc<RwLock<bool>>,
    /// Current network (mainnet/testnet/betanet)
    pub network: Arc<RwLock<String>>,
    /// Tauri app handle for emitting events to the frontend
    pub app_handle: Option<tauri::AppHandle>,
}

/// Start the connect WebSocket server
pub async fn start_connect_server(
    port: u16,
    session: Arc<RwLock<ConnectSession>>,
    active_address: Arc<RwLock<Option<String>>>,
    wallet_unlocked: Arc<RwLock<bool>>,
    network: Arc<RwLock<String>>,
    allowed_origins: Vec<String>,
    app_handle: Option<tauri::AppHandle>,
) -> Result<()> {
    let state = Arc::new(ConnectServerState {
        session,
        active_address,
        wallet_unlocked,
        network,
        app_handle,
    });

    // Build CORS layer — allow configured origins + always allow localhost variants
    let mut origin_list: Vec<HeaderValue> = allowed_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();

    // Always allow localhost for development
    for local in &["http://localhost", "http://127.0.0.1", "http://localhost:3000"] {
        if let Ok(hv) = local.parse() {
            if !origin_list.contains(&hv) {
                origin_list.push(hv);
            }
        }
    }

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origin_list))
        .allow_methods([Method::GET, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::ORIGIN]);

    let app = Router::new()
        .route("/parsec/v1/connect/health", get(health_handler))
        .route("/parsec/v1/connect/info", get(info_handler))
        .route("/parsec/v1/connect/ws", get(ws_handler))
        .layer(cors)
        .with_state(state);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ── HTTP Endpoints ───────────────────────────────────────────────

/// Health endpoint — dApps probe this to detect if PARSEC is running
async fn health_handler(
    AxumState(state): AxumState<Arc<ConnectServerState>>,
) -> Json<serde_json::Value> {
    let unlocked = *state.wallet_unlocked.read().await;
    let address = state.active_address.read().await.clone();
    let sess = state.session.read().await;

    Json(json!({
        "status": "ok",
        "wallet": "parsec",
        "version": env!("CARGO_PKG_VERSION"),
        "unlocked": unlocked,
        "hasAccount": address.is_some(),
        "activeSessions": sess.sessions.len(),
    }))
}

/// Info endpoint — detailed wallet info for integrators
async fn info_handler(
    AxumState(state): AxumState<Arc<ConnectServerState>>,
) -> Json<serde_json::Value> {
    let unlocked = *state.wallet_unlocked.read().await;
    let network = state.network.read().await.clone();
    let sess = state.session.read().await;

    Json(json!({
        "wallet": "parsec",
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": "parsec-connect/1.0",
        "unlocked": unlocked,
        "network": network,
        "capabilities": ["signTransaction", "accounts", "network"],
        "activeSessions": sess.sessions.len(),
        "pendingRequests": sess.pending_requests.len(),
        "allowedOrigins": sess.allowed_origins,
    }))
}

// ── WebSocket ────────────────────────────────────────────────────

/// WebSocket upgrade handler
async fn ws_handler(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<Arc<ConnectServerState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

/// Handle a single WebSocket connection from a dApp
async fn handle_ws_connection(mut socket: WebSocket, state: Arc<ConnectServerState>) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let session_id = format!("sess_{}", now.as_millis());

    // Register session
    {
        let mut sess = state.session.write().await;
        sess.sessions.insert(
            session_id.clone(),
            DappSession {
                session_id: session_id.clone(),
                origin: "unknown".into(),
                connected_at: now.as_secs(),
                account_address: None,
            },
        );
    }

    // Emit session connected event
    if let Some(ref handle) = state.app_handle {
        let _ = handle.emit("parsec-connect-session", json!({
            "type": "connected",
            "sessionId": session_id,
        }));
    }

    // Message loop
    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Text(text) => {
                let response = handle_json_rpc(&text, &session_id, &state).await;
                if let Ok(json_str) = serde_json::to_string(&response) {
                    if socket.send(Message::Text(json_str.into())).await.is_err() {
                        break;
                    }
                }
            }
            Message::Ping(data) => {
                if socket.send(Message::Pong(data)).await.is_err() {
                    break;
                }
            }
            Message::Close(_) => break,
            _ => {} // ignore binary
        }
    }

    // Clean up session and any pending requests for this session
    {
        let mut sess = state.session.write().await;
        sess.sessions.remove(&session_id);

        // Reject any pending sign requests from this session
        let pending_ids: Vec<u64> = sess
            .pending_requests
            .iter()
            .filter(|(_, r)| r.session_id == session_id)
            .map(|(id, _)| *id)
            .collect();

        for id in pending_ids {
            sess.pending_requests.remove(&id);
            if let Some(tx) = sess.response_channels.remove(&id) {
                let _ = tx
                    .send(SignResponse::Rejected {
                        reason: "dApp disconnected".into(),
                    })
                    .await;
            }
        }
    }

    // Emit session disconnected event
    if let Some(ref handle) = state.app_handle {
        let _ = handle.emit("parsec-connect-session", json!({
            "type": "disconnected",
            "sessionId": session_id,
        }));
    }
}

// ── JSON-RPC Handler ─────────────────────────────────────────────

/// Process a JSON-RPC request from a dApp
async fn handle_json_rpc(
    text: &str,
    session_id: &str,
    state: &Arc<ConnectServerState>,
) -> JsonRpcResponse {
    let req: JsonRpcRequest = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(e) => {
            return JsonRpcResponse::error(0, -32700, format!("Parse error: {}", e));
        }
    };

    match req.method.as_str() {
        "ping" => JsonRpcResponse::success(req.id, json!({"pong": true})),
        "parsec_accounts" => handle_accounts(req.id, session_id, state).await,
        "parsec_network" => handle_network(req.id, state).await,
        "parsec_signTransactions" => {
            handle_sign_transactions(req.id, &req.params, session_id, state).await
        }
        _ => JsonRpcResponse::error(req.id, -32601, format!("Unknown method: {}", req.method)),
    }
}

/// Handle parsec_accounts — return the active wallet address
async fn handle_accounts(
    id: u64,
    session_id: &str,
    state: &Arc<ConnectServerState>,
) -> JsonRpcResponse {
    let unlocked = *state.wallet_unlocked.read().await;
    if !unlocked {
        return JsonRpcResponse::error(id, 4100, "Wallet is locked".into());
    }

    let address = state.active_address.read().await.clone();
    let network = state.network.read().await.clone();

    match address {
        Some(ref addr) => {
            // Update session with connected address
            {
                let mut sess = state.session.write().await;
                if let Some(dapp_sess) = sess.sessions.get_mut(session_id) {
                    dapp_sess.account_address = Some(addr.clone());
                }
            }

            JsonRpcResponse::success(
                id,
                json!({
                    "accounts": [{
                        "address": addr,
                        "label": "PARSEC",
                        "network": network,
                    }]
                }),
            )
        }
        None => JsonRpcResponse::error(id, 4100, "No active account".into()),
    }
}

/// Handle parsec_network — return current network info
async fn handle_network(id: u64, state: &Arc<ConnectServerState>) -> JsonRpcResponse {
    let network = state.network.read().await.clone();
    JsonRpcResponse::success(
        id,
        json!({
            "network": network,
            "algodUrl": match network.as_str() {
                "mainnet" => "https://mainnet-api.4160.nodely.dev",
                "testnet" => "https://testnet-api.4160.nodely.dev",
                "betanet" => "https://betanet-api.4160.nodely.dev",
                _ => "https://mainnet-api.4160.nodely.dev",
            },
        }),
    )
}

/// Handle parsec_signTransactions — queue for user approval
async fn handle_sign_transactions(
    id: u64,
    params: &serde_json::Value,
    session_id: &str,
    state: &Arc<ConnectServerState>,
) -> JsonRpcResponse {
    let unlocked = *state.wallet_unlocked.read().await;
    if !unlocked {
        return JsonRpcResponse::error(id, 4100, "Wallet is locked".into());
    }

    // Parse transaction bytes from params
    let txns_b64: Vec<String> = match params.get("txns") {
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => {
            return JsonRpcResponse::error(id, -32602, "Missing 'txns' array parameter".into());
        }
    };

    if txns_b64.is_empty() {
        return JsonRpcResponse::error(id, -32602, "Empty transaction list".into());
    }

    // Limit transactions per request
    if txns_b64.len() > 16 {
        return JsonRpcResponse::error(
            id,
            -32602,
            "Too many transactions (max 16 per request)".into(),
        );
    }

    let origin = params
        .get("origin")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Update session origin
    {
        let mut sess = state.session.write().await;
        if let Some(dapp_sess) = sess.sessions.get_mut(session_id) {
            dapp_sess.origin = origin.clone();
        }
    }

    // Create a channel for the approval response
    let (tx, mut rx) = mpsc::channel::<SignResponse>(1);

    let request_id = {
        let mut sess = state.session.write().await;
        sess.next_request_id += 1;
        let request_id = sess.next_request_id;

        let sign_req = SignRequest {
            request_id,
            session_id: session_id.to_string(),
            origin: origin.clone(),
            message,
            txn_count: txns_b64.len(),
            txns_b64,
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };

        sess.pending_requests.insert(request_id, sign_req.clone());
        sess.response_channels.insert(request_id, tx);

        // Emit event to PARSEC frontend for approval dialog
        if let Some(ref handle) = state.app_handle {
            let _ = handle.emit("parsec-connect-sign-request", &sign_req);
        }

        request_id
    };

    // Wait for user response (timeout after 120 seconds)
    let response = tokio::time::timeout(std::time::Duration::from_secs(120), rx.recv()).await;

    // Clean up
    {
        let mut sess = state.session.write().await;
        sess.pending_requests.remove(&request_id);
        sess.response_channels.remove(&request_id);
    }

    match response {
        Ok(Some(SignResponse::Approved { signed_txns_b64 })) => JsonRpcResponse::success(
            id,
            json!({ "signedTxns": signed_txns_b64 }),
        ),
        Ok(Some(SignResponse::Rejected { reason })) => {
            JsonRpcResponse::error(id, 4001, format!("User rejected: {}", reason))
        }
        Ok(None) => JsonRpcResponse::error(id, 4001, "Request cancelled".into()),
        Err(_) => JsonRpcResponse::error(id, 4002, "Request timed out (120s)".into()),
    }
}
