//! parsec_mesh — Sovereign P2P mesh where every client is also a server
//!
//! Architecture:
//! - Each PARSEC node is both consumer and provider
//! - Handoffs happen via IPFS CIDs: data is content-addressed, location-independent
//! - Peers discover each other through the PostgreSQL registry or IPFS DHT
//! - Resource exchange is tracked: CPU cycles, bandwidth, storage ↔ crypto value
//! - All security is open source per cypherpunk2048 standard
//!
//! The mesh layer does NOT depend on any centralized service.
//! PostgreSQL is used for local indexing only — the peer can operate without it.

pub mod commands;
pub mod ipfs;
pub mod peer;
pub mod resource;
pub mod server;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Mesh state managed by Tauri
pub struct MeshState {
    pub inner: Arc<RwLock<MeshSession>>,
}

impl Default for MeshState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(MeshSession::default())),
        }
    }
}

/// Active mesh session
#[derive(Default)]
pub struct MeshSession {
    /// Our peer identity
    pub local_peer: Option<LocalPeer>,
    /// Known peers
    pub peers: HashMap<String, PeerInfo>,
    /// IPFS gateway configuration
    pub ipfs_config: Option<IpfsConfig>,
    /// Whether the local server is running
    pub server_running: bool,
    /// Port the local server listens on
    pub server_port: Option<u16>,
    /// Resource budget for this session
    pub resource_budget: ResourceBudget,
}

/// Our identity on the mesh
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPeer {
    pub peer_id: String,
    pub public_key: String,
    pub listen_addresses: Vec<String>,
    pub ipfs_peer_id: Option<String>,
    pub capabilities: Vec<String>,
}

/// A remote peer on the mesh
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id: String,
    pub public_key: String,
    pub addresses: Vec<String>,
    pub ipfs_peer_id: Option<String>,
    pub capabilities: Vec<String>,
    pub resource_map: ResourceMap,
    pub reputation: f32,
    pub last_seen: u64,
}

/// IPFS configuration for content-addressed handoffs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpfsConfig {
    /// Local IPFS API endpoint (e.g. http://127.0.0.1:5001)
    pub api_url: String,
    /// Gateway URL for retrieving content (e.g. http://127.0.0.1:8080)
    pub gateway_url: String,
    /// Whether to pin content by default
    pub auto_pin: bool,
    /// Maximum pinned storage in bytes
    pub max_pin_bytes: u64,
}

impl Default for IpfsConfig {
    fn default() -> Self {
        Self {
            api_url: "http://127.0.0.1:5001".into(),
            gateway_url: "http://127.0.0.1:8080".into(),
            auto_pin: true,
            max_pin_bytes: 1_073_741_824, // 1 GB default
        }
    }
}

/// Resource map: what a peer has available to exchange
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResourceMap {
    /// Available CPU cores (fractional)
    pub cpu_cores: f64,
    /// CPU utilization percentage (0-100)
    pub cpu_usage_pct: f64,
    /// Available RAM in bytes
    pub ram_available: u64,
    /// Available disk in bytes
    pub disk_available: u64,
    /// Network bandwidth up (bytes/sec)
    pub bandwidth_up: u64,
    /// Network bandwidth down (bytes/sec)
    pub bandwidth_down: u64,
    /// Estimated power draw (watts) — maps electricity cost to crypto exchange
    pub power_draw_watts: f64,
    /// Electricity cost per kWh in the peer's locale (USD equivalent)
    pub electricity_cost_kwh: f64,
}

/// Budget: how much resource this node is willing to share
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceBudget {
    /// Max bandwidth to share (bytes/sec, 0 = unlimited)
    pub max_bandwidth_share: u64,
    /// Max CPU percentage to share for mesh tasks
    pub max_cpu_share_pct: u8,
    /// Max storage to offer for IPFS pinning (bytes)
    pub max_storage_share: u64,
    /// Max power budget (watts) — won't exceed this for mesh work
    pub max_power_watts: f64,
}

impl Default for ResourceBudget {
    fn default() -> Self {
        Self {
            max_bandwidth_share: 10_485_760, // 10 MB/s default
            max_cpu_share_pct: 25,
            max_storage_share: 536_870_912, // 512 MB
            max_power_watts: 50.0,
        }
    }
}

/// A content handoff via IPFS
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentHandoff {
    /// IPFS CID of the content
    pub cid: String,
    /// Human-readable description
    pub description: String,
    /// Size in bytes
    pub size_bytes: u64,
    /// Which peer originated this content
    pub origin_peer: String,
    /// Cryptographic signature from the origin peer
    pub signature: String,
    /// Timestamp
    pub created_at: u64,
    /// Optional expiry
    pub expires_at: Option<u64>,
}
