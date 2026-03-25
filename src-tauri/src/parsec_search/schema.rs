//! Schema initialization for the search index tables.
//!
//! Creates tables with both tsvector (full-text) and vector (semantic) columns.
//! Uses pgvectorscale StreamingDiskANN index when available, falls back to HNSW.

use anyhow::{Context, Result};
use sqlx::PgPool;

/// Initialize the search schema.
/// Creates tables, indexes, and triggers for the hybrid search engine.
pub async fn initialize_schema(
    pool: &PgPool,
    embedding_dim: u32,
    use_diskann: bool,
) -> Result<()> {
    // Core documents table with hybrid search columns
    let create_table = format!(
        r#"
        CREATE TABLE IF NOT EXISTS parsec_documents (
            id              TEXT PRIMARY KEY,
            doc_type        TEXT NOT NULL,
            chain           TEXT NOT NULL DEFAULT 'any',
            content         TEXT NOT NULL DEFAULT '',
            metadata        JSONB NOT NULL DEFAULT '{{}}'::jsonb,
            embedding       vector({dim}),
            search_vector   tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('english', coalesce(doc_type, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(chain, '')), 'B') ||
                setweight(to_tsvector('english', coalesce(content, '')), 'C')
            ) STORED,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        "#,
        dim = embedding_dim
    );
    sqlx::query(&create_table)
        .execute(pool)
        .await
        .context("Failed to create parsec_documents table")?;

    // GIN index for full-text search
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_parsec_documents_search \
         ON parsec_documents USING gin(search_vector)",
    )
    .execute(pool)
    .await
    .context("Failed to create GIN index")?;

    // Vector index: DiskANN (pgvectorscale) or HNSW (pgvector fallback)
    if use_diskann {
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_parsec_documents_embedding \
             ON parsec_documents USING diskann(embedding)",
        )
        .execute(pool)
        .await
        .context("Failed to create DiskANN index")?;
    } else {
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_parsec_documents_embedding \
             ON parsec_documents USING hnsw(embedding vector_cosine_ops)",
        )
        .execute(pool)
        .await
        .context("Failed to create HNSW index")?;
    }

    // B-tree indexes for common filters
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_parsec_documents_type ON parsec_documents(doc_type)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_parsec_documents_chain ON parsec_documents(chain)",
    )
    .execute(pool)
    .await?;

    // JSONB index for metadata filtering
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_parsec_documents_metadata \
         ON parsec_documents USING gin(metadata jsonb_path_ops)",
    )
    .execute(pool)
    .await?;

    // Chain registry table — allchainz network profiles
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS parsec_chains (
            chain_id        TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            family          TEXT NOT NULL,
            rpc_urls        JSONB NOT NULL DEFAULT '[]'::jsonb,
            explorer_urls   JSONB NOT NULL DEFAULT '[]'::jsonb,
            native_asset    JSONB NOT NULL DEFAULT '{}'::jsonb,
            address_format  TEXT NOT NULL,
            is_active       BOOLEAN NOT NULL DEFAULT true,
            metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        "#,
    )
    .execute(pool)
    .await
    .context("Failed to create parsec_chains table")?;

    // dApp access permissions table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS parsec_dapp_permissions (
            dapp_id         TEXT NOT NULL,
            account_address TEXT NOT NULL,
            fs_access_level SMALLINT NOT NULL DEFAULT 1 CHECK (fs_access_level BETWEEN 1 AND 10),
            allowed_paths   JSONB NOT NULL DEFAULT '[]'::jsonb,
            denied_paths    JSONB NOT NULL DEFAULT '[]'::jsonb,
            bandwidth_cap   BIGINT DEFAULT NULL,
            cpu_cap_pct     SMALLINT DEFAULT NULL CHECK (cpu_cap_pct BETWEEN 0 AND 100),
            granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at      TIMESTAMPTZ DEFAULT NULL,
            PRIMARY KEY (dapp_id, account_address)
        )
        "#,
    )
    .execute(pool)
    .await
    .context("Failed to create parsec_dapp_permissions table")?;

    // Peer mesh table — client-as-server peer registry
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS parsec_peers (
            peer_id         TEXT PRIMARY KEY,
            public_key      TEXT NOT NULL,
            addresses       JSONB NOT NULL DEFAULT '[]'::jsonb,
            ipfs_peer_id    TEXT,
            capabilities    JSONB NOT NULL DEFAULT '[]'::jsonb,
            resource_map    JSONB NOT NULL DEFAULT '{}'::jsonb,
            last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
            reputation      REAL NOT NULL DEFAULT 0.5,
            is_active       BOOLEAN NOT NULL DEFAULT true
        )
        "#,
    )
    .execute(pool)
    .await
    .context("Failed to create parsec_peers table")?;

    // Throttle metrics table — resource exchange tracking
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS parsec_throttle_metrics (
            id              BIGSERIAL PRIMARY KEY,
            peer_id         TEXT NOT NULL,
            metric_type     TEXT NOT NULL,
            value           DOUBLE PRECISION NOT NULL,
            unit            TEXT NOT NULL,
            recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        "#,
    )
    .execute(pool)
    .await
    .context("Failed to create parsec_throttle_metrics table")?;

    // TimescaleDB hypertable for metrics if available (optional)
    let _ = sqlx::query(
        "SELECT create_hypertable('parsec_throttle_metrics', 'recorded_at', \
         if_not_exists => true)",
    )
    .execute(pool)
    .await;
    // Silently ignore if TimescaleDB not installed

    Ok(())
}
