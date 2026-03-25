//! Peer discovery and identity management
//!
//! Peers are identified by their wallet public key.
//! Discovery happens through:
//! 1. PostgreSQL peer registry (when search backend is connected)
//! 2. IPFS DHT (when IPFS daemon is running)
//! 3. Direct address exchange (QR code, manual entry)

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use super::{LocalPeer, PeerInfo, ResourceMap};

/// Generate a peer ID from a wallet public key
pub fn peer_id_from_pubkey(public_key: &str) -> String {
    use sha3::{Digest, Sha3_256};
    let hash = Sha3_256::digest(public_key.as_bytes());
    format!("parsec-{}", hex::encode(&hash[..16]))
}

/// Register this peer in the PostgreSQL peer registry
pub async fn register_peer(pool: &sqlx::PgPool, peer: &LocalPeer) -> Result<()> {
    let addresses = serde_json::to_value(&peer.listen_addresses)?;
    let capabilities = serde_json::to_value(&peer.capabilities)?;

    sqlx::query(
        r#"
        INSERT INTO parsec_peers (peer_id, public_key, addresses, ipfs_peer_id, capabilities, last_seen)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (peer_id) DO UPDATE SET
            addresses = EXCLUDED.addresses,
            ipfs_peer_id = EXCLUDED.ipfs_peer_id,
            capabilities = EXCLUDED.capabilities,
            last_seen = now(),
            is_active = true
        "#,
    )
    .bind(&peer.peer_id)
    .bind(&peer.public_key)
    .bind(&addresses)
    .bind(&peer.ipfs_peer_id)
    .bind(&capabilities)
    .execute(pool)
    .await
    .context("Failed to register peer")?;

    Ok(())
}

/// Update resource map for a peer
pub async fn update_resource_map(
    pool: &sqlx::PgPool,
    peer_id: &str,
    resources: &ResourceMap,
) -> Result<()> {
    let resource_json = serde_json::to_value(resources)?;
    sqlx::query(
        "UPDATE parsec_peers SET resource_map = $1, last_seen = now() WHERE peer_id = $2",
    )
    .bind(&resource_json)
    .bind(peer_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Discover active peers from the registry
pub async fn discover_peers(
    pool: &sqlx::PgPool,
    max_age_secs: i64,
    limit: i64,
) -> Result<Vec<PeerInfo>> {
    let rows = sqlx::query_as::<_, PeerRow>(
        r#"
        SELECT peer_id, public_key, addresses, ipfs_peer_id, capabilities,
               resource_map, reputation, EXTRACT(EPOCH FROM last_seen)::bigint AS last_seen_epoch
        FROM parsec_peers
        WHERE is_active = true
          AND last_seen > now() - make_interval(secs => $1)
        ORDER BY reputation DESC, last_seen DESC
        LIMIT $2
        "#,
    )
    .bind(max_age_secs as f64)
    .bind(limit)
    .fetch_all(pool)
    .await
    .context("Failed to discover peers")?;

    Ok(rows
        .into_iter()
        .map(|r| PeerInfo {
            peer_id: r.peer_id,
            public_key: r.public_key,
            addresses: serde_json::from_value(r.addresses).unwrap_or_default(),
            ipfs_peer_id: r.ipfs_peer_id,
            capabilities: serde_json::from_value(r.capabilities).unwrap_or_default(),
            resource_map: serde_json::from_value(r.resource_map).unwrap_or_default(),
            reputation: r.reputation,
            last_seen: r.last_seen_epoch as u64,
        })
        .collect())
}

/// Mark a peer as inactive
pub async fn deactivate_peer(pool: &sqlx::PgPool, peer_id: &str) -> Result<()> {
    sqlx::query("UPDATE parsec_peers SET is_active = false WHERE peer_id = $1")
        .bind(peer_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Update peer reputation based on interaction outcomes
pub async fn update_reputation(
    pool: &sqlx::PgPool,
    peer_id: &str,
    delta: f32,
) -> Result<f32> {
    let new_rep: f32 = sqlx::query_scalar(
        r#"
        UPDATE parsec_peers
        SET reputation = GREATEST(0.0, LEAST(1.0, reputation + $1))
        WHERE peer_id = $2
        RETURNING reputation
        "#,
    )
    .bind(delta)
    .bind(peer_id)
    .fetch_one(pool)
    .await
    .context("Failed to update reputation")?;

    Ok(new_rep)
}

#[derive(sqlx::FromRow)]
struct PeerRow {
    peer_id: String,
    public_key: String,
    addresses: serde_json::Value,
    ipfs_peer_id: Option<String>,
    capabilities: serde_json::Value,
    resource_map: serde_json::Value,
    reputation: f32,
    last_seen_epoch: i64,
}
