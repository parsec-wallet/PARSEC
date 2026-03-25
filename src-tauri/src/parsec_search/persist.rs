//! Persistence bridge: write throttle metrics and sandbox permissions to PostgreSQL
//!
//! This module connects parsec_throttle and parsec_sandbox to the search backend.
//! When a PostgreSQL pool is available, metrics and permissions are persisted.

use anyhow::{Context, Result};
use sqlx::PgPool;

use crate::parsec_sandbox::DappPermission;
use crate::parsec_throttle::ThrottleMetric;

// --- Throttle metrics persistence ---

/// Write a batch of throttle metrics to the parsec_throttle_metrics table
pub async fn persist_throttle_metrics(pool: &PgPool, metrics: &[ThrottleMetric]) -> Result<usize> {
    let mut count = 0;
    for m in metrics {
        sqlx::query(
            r#"
            INSERT INTO parsec_throttle_metrics (peer_id, metric_type, value, unit, recorded_at)
            VALUES ($1, $2, $3, $4, to_timestamp($5))
            "#,
        )
        .bind(&m.source_id)
        .bind(&m.metric_type)
        .bind(m.value)
        .bind(&m.unit)
        .bind(m.timestamp as f64)
        .execute(pool)
        .await
        .context("Failed to persist throttle metric")?;
        count += 1;
    }
    Ok(count)
}

/// Query recent throttle metrics for a peer
pub async fn query_throttle_metrics(
    pool: &PgPool,
    peer_id: &str,
    limit: i64,
) -> Result<Vec<ThrottleMetric>> {
    let rows = sqlx::query_as::<_, MetricRow>(
        r#"
        SELECT peer_id, metric_type, value, unit,
               EXTRACT(EPOCH FROM recorded_at)::bigint AS ts
        FROM parsec_throttle_metrics
        WHERE peer_id = $1
        ORDER BY recorded_at DESC
        LIMIT $2
        "#,
    )
    .bind(peer_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .context("Failed to query throttle metrics")?;

    Ok(rows
        .into_iter()
        .map(|r| ThrottleMetric {
            source_id: r.peer_id,
            metric_type: r.metric_type,
            value: r.value,
            unit: r.unit,
            timestamp: r.ts as u64,
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct MetricRow {
    peer_id: String,
    metric_type: String,
    value: f64,
    unit: String,
    ts: i64,
}

// --- Sandbox permissions persistence ---

/// Persist a dApp permission to PostgreSQL
pub async fn persist_dapp_permission(pool: &PgPool, perm: &DappPermission) -> Result<()> {
    let allowed_paths = serde_json::Value::Array(vec![]);
    let denied_paths = serde_json::Value::Array(vec![]);

    sqlx::query(
        r#"
        INSERT INTO parsec_dapp_permissions
            (dapp_id, account_address, fs_access_level, allowed_paths, denied_paths, granted_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7)
        ON CONFLICT (dapp_id, account_address) DO UPDATE SET
            fs_access_level = EXCLUDED.fs_access_level,
            allowed_paths = EXCLUDED.allowed_paths,
            denied_paths = EXCLUDED.denied_paths,
            expires_at = EXCLUDED.expires_at
        "#,
    )
    .bind(&perm.dapp_id)
    .bind(&perm.granted_by)
    .bind(perm.access_level as i16)
    .bind(&allowed_paths)
    .bind(&denied_paths)
    .bind(perm.granted_at as f64)
    .bind(perm.expires_at.map(|e| e as f64))
    .execute(pool)
    .await
    .context("Failed to persist dApp permission")?;

    Ok(())
}

/// Load all dApp permissions from PostgreSQL for a specific account
pub async fn load_dapp_permissions(
    pool: &PgPool,
    account_address: &str,
) -> Result<Vec<PermissionRow>> {
    let rows = sqlx::query_as::<_, PermissionRow>(
        r#"
        SELECT dapp_id, account_address, fs_access_level,
               EXTRACT(EPOCH FROM granted_at)::bigint AS granted_ts,
               EXTRACT(EPOCH FROM expires_at)::bigint AS expires_ts
        FROM parsec_dapp_permissions
        WHERE account_address = $1
        "#,
    )
    .bind(account_address)
    .fetch_all(pool)
    .await
    .context("Failed to load dApp permissions")?;

    Ok(rows)
}

/// Delete a dApp permission from PostgreSQL
pub async fn delete_dapp_permission(
    pool: &PgPool,
    dapp_id: &str,
    account_address: &str,
) -> Result<bool> {
    let result = sqlx::query(
        "DELETE FROM parsec_dapp_permissions WHERE dapp_id = $1 AND account_address = $2",
    )
    .bind(dapp_id)
    .bind(account_address)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct PermissionRow {
    pub dapp_id: String,
    pub account_address: String,
    pub fs_access_level: i16,
    pub granted_ts: Option<i64>,
    pub expires_ts: Option<i64>,
}
