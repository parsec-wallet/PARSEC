//! parsec_connect — WebSocket bridge for dApp wallet communication
//!
//! Allows web dApps (e.g. AgenticPlace) to connect to Parsec Wallet
//! via a local WebSocket on localhost:9876. The dApp can request:
//!   - Account addresses
//!   - Transaction signing (with user approval)
//!
//! All signing requests go through the sandbox permission system
//! and require explicit user approval via the frontend dialog.
//!
//! Protocol: JSON-RPC over WebSocket
//! CORS: only whitelisted origins (configurable)

pub mod commands;
pub mod server;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

/// Connect state managed by Tauri
pub struct ConnectState {
    pub inner: Arc<RwLock<ConnectSession>>,
}

impl Default for ConnectState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(ConnectSession::default())),
        }
    }
}

/// Active connect session state
#[derive(Default)]
pub struct ConnectSession {
    /// Whether the connect server is running
    pub server_running: bool,
    /// Port the server listens on
    pub port: u16,
    /// Connected dApp sessions
    pub sessions: HashMap<String, DappSession>,
    /// Pending sign requests awaiting user approval
    pub pending_requests: HashMap<u64, SignRequest>,
    /// Next request ID
    pub next_request_id: u64,
    /// Allowed origins for CORS
    pub allowed_origins: Vec<String>,
    /// Channel to send approval/rejection to waiting handlers
    pub response_channels: HashMap<u64, mpsc::Sender<SignResponse>>,
}

/// A connected dApp session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DappSession {
    pub session_id: String,
    pub origin: String,
    pub connected_at: u64,
    pub account_address: Option<String>,
}

/// A pending sign request from a dApp
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignRequest {
    pub request_id: u64,
    pub session_id: String,
    pub origin: String,
    pub message: String,
    pub txn_count: usize,
    /// Base64-encoded unsigned transaction bytes
    pub txns_b64: Vec<String>,
    pub created_at: u64,
}

/// Response to a sign request (from user approval flow)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SignResponse {
    Approved {
        /// Base64-encoded signed transaction bytes
        signed_txns_b64: Vec<String>,
    },
    Rejected {
        reason: String,
    },
}

// ── JSON-RPC protocol types ──

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

impl JsonRpcResponse {
    pub fn success(id: u64, result: serde_json::Value) -> Self {
        Self {
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: u64, code: i32, message: String) -> Self {
        Self {
            id,
            result: None,
            error: Some(JsonRpcError { code, message }),
        }
    }
}
