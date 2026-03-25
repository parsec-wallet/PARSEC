//! IPFS integration for content-addressed handoffs
//!
//! Uses the local IPFS daemon HTTP API (Kubo-compatible).
//! No external IPFS libraries — pure HTTP to the local daemon.
//! Content is pinned locally and shared via the mesh.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use super::IpfsConfig;

/// Add content to IPFS and return the CID
pub async fn add_content(config: &IpfsConfig, data: &[u8]) -> Result<String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v0/add?pin={}", config.api_url, config.auto_pin);

    let part = reqwest::multipart::Part::bytes(data.to_vec()).file_name("data");
    let form = reqwest::multipart::Form::new().part("file", part);

    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .context("Failed to add content to IPFS")?;

    let body: IpfsAddResponse = resp.json().await.context("Failed to parse IPFS add response")?;
    Ok(body.hash)
}

/// Retrieve content from IPFS by CID
pub async fn get_content(config: &IpfsConfig, cid: &str) -> Result<Vec<u8>> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v0/cat?arg={}", config.api_url, cid);

    let resp = client
        .post(&url)
        .send()
        .await
        .context("Failed to get content from IPFS")?;

    let bytes = resp
        .bytes()
        .await
        .context("Failed to read IPFS content")?;
    Ok(bytes.to_vec())
}

/// Pin content to prevent garbage collection
pub async fn pin_content(config: &IpfsConfig, cid: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v0/pin/add?arg={}", config.api_url, cid);

    client
        .post(&url)
        .send()
        .await
        .context("Failed to pin content")?;

    Ok(())
}

/// Unpin content to allow garbage collection
pub async fn unpin_content(config: &IpfsConfig, cid: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v0/pin/rm?arg={}", config.api_url, cid);

    client
        .post(&url)
        .send()
        .await
        .context("Failed to unpin content")?;

    Ok(())
}

/// Get local IPFS node identity (peer ID)
pub async fn get_peer_id(config: &IpfsConfig) -> Result<String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v0/id", config.api_url);

    let resp = client
        .post(&url)
        .send()
        .await
        .context("Failed to get IPFS peer ID")?;

    let body: IpfsIdResponse = resp.json().await.context("Failed to parse IPFS ID response")?;
    Ok(body.id)
}

/// List pinned content with their sizes
pub async fn list_pins(config: &IpfsConfig) -> Result<Vec<PinnedContent>> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v0/pin/ls?type=recursive", config.api_url);

    let resp = client
        .post(&url)
        .send()
        .await
        .context("Failed to list pins")?;

    let body: IpfsPinLsResponse = resp.json().await.context("Failed to parse pin list")?;

    Ok(body
        .keys
        .into_iter()
        .map(|(cid, info)| PinnedContent {
            cid,
            pin_type: info.r#type,
        })
        .collect())
}

/// Check if the local IPFS daemon is reachable
pub async fn is_daemon_running(config: &IpfsConfig) -> bool {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v0/version", config.api_url);
    client.post(&url).send().await.is_ok()
}

/// Get IPFS repo stats (storage usage)
pub async fn repo_stats(config: &IpfsConfig) -> Result<RepoStats> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v0/repo/stat", config.api_url);

    let resp = client
        .post(&url)
        .send()
        .await
        .context("Failed to get repo stats")?;

    resp.json().await.context("Failed to parse repo stats")
}

// --- Response types ---

#[derive(Deserialize)]
struct IpfsAddResponse {
    #[serde(rename = "Hash")]
    hash: String,
}

#[derive(Deserialize)]
struct IpfsIdResponse {
    #[serde(rename = "ID")]
    id: String,
}

#[derive(Deserialize)]
struct IpfsPinLsResponse {
    #[serde(rename = "Keys")]
    keys: std::collections::HashMap<String, PinInfo>,
}

#[derive(Deserialize)]
struct PinInfo {
    #[serde(rename = "Type")]
    r#type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PinnedContent {
    pub cid: String,
    pub pin_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoStats {
    #[serde(rename = "RepoSize")]
    pub repo_size: u64,
    #[serde(rename = "StorageMax")]
    pub storage_max: u64,
    #[serde(rename = "NumObjects")]
    pub num_objects: u64,
}
