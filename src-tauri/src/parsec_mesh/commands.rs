//! Tauri IPC commands for parsec_mesh
//!
//! Exposes the P2P mesh, IPFS handoffs, and resource mapping to the frontend.

use std::sync::Arc;
use tauri::State;

use super::ipfs;
use super::resource;
use super::server;
use super::{
    ContentHandoff, IpfsConfig, LocalPeer, MeshState, PeerInfo, ResourceBudget, ResourceMap,
};

/// Initialize the mesh with a local peer identity
#[tauri::command]
pub async fn mesh_init(
    state: State<'_, MeshState>,
    public_key: String,
    listen_port: u16,
    ipfs_config: Option<IpfsConfig>,
) -> Result<LocalPeer, String> {
    let peer_id = super::peer::peer_id_from_pubkey(&public_key);

    let ipfs_peer_id = if let Some(ref config) = ipfs_config {
        ipfs::get_peer_id(config).await.ok()
    } else {
        None
    };

    let local_peer = LocalPeer {
        peer_id,
        public_key,
        listen_addresses: vec![format!("0.0.0.0:{}", listen_port)],
        ipfs_peer_id,
        capabilities: vec![
            "search".into(),
            "handoff".into(),
            "relay".into(),
        ],
    };

    let mut session = state.inner.write().await;
    session.local_peer = Some(local_peer.clone());
    session.ipfs_config = ipfs_config;
    session.server_port = Some(listen_port);

    Ok(local_peer)
}

/// Start the embedded server (makes this client a server too)
#[tauri::command]
pub async fn mesh_start_server(
    state: State<'_, MeshState>,
) -> Result<String, String> {
    let session = state.inner.read().await;
    let port = session
        .server_port
        .ok_or("Mesh not initialized — call mesh_init first")?;

    let budget = Arc::new(tokio::sync::RwLock::new(session.resource_budget.clone()));

    let port_copy = port;
    tokio::spawn(async move {
        if let Err(e) = server::start_server(port_copy, budget).await {
            eprintln!("Mesh server error: {}", e);
        }
    });

    drop(session);
    let mut session = state.inner.write().await;
    session.server_running = true;

    Ok(format!("Server listening on port {}", port))
}

/// Get current resource snapshot
#[tauri::command]
pub async fn mesh_resources() -> Result<ResourceMap, String> {
    Ok(resource::snapshot_resources())
}

/// Get throttle parameters based on current resources and budget
#[tauri::command]
pub async fn mesh_throttle(
    state: State<'_, MeshState>,
) -> Result<resource::ThrottleParams, String> {
    let session = state.inner.read().await;
    let budget = &session.resource_budget;
    let resources = resource::snapshot_resources();

    Ok(resource::compute_throttle(
        &resources,
        budget.max_cpu_share_pct,
        budget.max_bandwidth_share,
        budget.max_power_watts,
    ))
}

/// Update the resource budget
#[tauri::command]
pub async fn mesh_set_budget(
    state: State<'_, MeshState>,
    budget: ResourceBudget,
) -> Result<(), String> {
    let mut session = state.inner.write().await;
    session.resource_budget = budget;
    Ok(())
}

/// Compute resource cost for a given work period
#[tauri::command]
pub async fn mesh_resource_cost(
    duration_secs: f64,
    avg_power_watts: f64,
    cost_per_kwh: f64,
    bandwidth_bytes: u64,
    bandwidth_cost_per_gb: f64,
) -> Result<resource::ResourceCost, String> {
    Ok(resource::compute_resource_cost(
        duration_secs,
        avg_power_watts,
        cost_per_kwh,
        bandwidth_bytes,
        bandwidth_cost_per_gb,
    ))
}

/// Add content to IPFS for handoff
#[tauri::command]
pub async fn mesh_ipfs_add(
    state: State<'_, MeshState>,
    data: Vec<u8>,
) -> Result<String, String> {
    let session = state.inner.read().await;
    let config = session
        .ipfs_config
        .as_ref()
        .ok_or("IPFS not configured")?;
    ipfs::add_content(config, &data)
        .await
        .map_err(|e| e.to_string())
}

/// Get content from IPFS by CID
#[tauri::command]
pub async fn mesh_ipfs_get(
    state: State<'_, MeshState>,
    cid: String,
) -> Result<Vec<u8>, String> {
    let session = state.inner.read().await;
    let config = session
        .ipfs_config
        .as_ref()
        .ok_or("IPFS not configured")?;
    ipfs::get_content(config, &cid)
        .await
        .map_err(|e| e.to_string())
}

/// Check if IPFS daemon is running
#[tauri::command]
pub async fn mesh_ipfs_status(
    state: State<'_, MeshState>,
) -> Result<bool, String> {
    let session = state.inner.read().await;
    match &session.ipfs_config {
        Some(config) => Ok(ipfs::is_daemon_running(config).await),
        None => Ok(false),
    }
}

/// List IPFS pins
#[tauri::command]
pub async fn mesh_ipfs_pins(
    state: State<'_, MeshState>,
) -> Result<Vec<ipfs::PinnedContent>, String> {
    let session = state.inner.read().await;
    let config = session
        .ipfs_config
        .as_ref()
        .ok_or("IPFS not configured")?;
    ipfs::list_pins(config)
        .await
        .map_err(|e| e.to_string())
}
