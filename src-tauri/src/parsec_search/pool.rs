//! Connection pool management for PostgreSQL + pgvectorscale

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

use super::SearchConfig;

/// Create a connection pool with the given configuration
pub async fn create_pool(config: &SearchConfig) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .idle_timeout(std::time::Duration::from_secs(300))
        .connect(&config.database_url)
        .await
        .context("Failed to connect to PostgreSQL")?;

    Ok(pool)
}

/// Detect whether pgvector and pgvectorscale extensions are available
pub async fn detect_extensions(pool: &PgPool) -> Result<(bool, bool)> {
    let has_pgvector: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'vector')",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    let has_vectorscale: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'vectorscale')",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    Ok((has_pgvector, has_vectorscale))
}

/// Ensure extensions are created (requires superuser or extension owner)
pub async fn ensure_extensions(pool: &PgPool, has_vectorscale: bool) -> Result<()> {
    sqlx::query("CREATE EXTENSION IF NOT EXISTS vector")
        .execute(pool)
        .await
        .context("Failed to create pgvector extension")?;

    if has_vectorscale {
        sqlx::query("CREATE EXTENSION IF NOT EXISTS vectorscale CASCADE")
            .execute(pool)
            .await
            .context("Failed to create pgvectorscale extension")?;
    }

    Ok(())
}

/// Health check — verify the pool is alive and extensions functional
pub async fn health_check(pool: &PgPool) -> Result<HealthStatus> {
    let pg_version: String =
        sqlx::query_scalar("SELECT version()")
            .fetch_one(pool)
            .await
            .context("PostgreSQL health check failed")?;

    let pool_size = pool.size();
    let idle_connections = pool.num_idle();

    let (has_pgvector, has_vectorscale) = detect_extensions(pool).await?;

    Ok(HealthStatus {
        connected: true,
        pg_version,
        pool_size,
        idle_connections,
        has_pgvector,
        has_vectorscale,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HealthStatus {
    pub connected: bool,
    pub pg_version: String,
    pub pool_size: u32,
    pub idle_connections: usize,
    pub has_pgvector: bool,
    pub has_vectorscale: bool,
}
