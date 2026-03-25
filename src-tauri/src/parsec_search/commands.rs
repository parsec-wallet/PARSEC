//! Tauri IPC commands for parsec_search
//!
//! These commands expose the PostgreSQL + pgvectorscale search engine
//! to the frontend via Tauri's invoke system.

use tauri::State;

use super::pool::{self, HealthStatus};
use super::schema;
use super::search;
use super::{SearchConfig, SearchDocument, SearchQuery, SearchResult, SearchState};

/// Connect to PostgreSQL and initialize the search schema
#[tauri::command]
pub async fn search_connect(
    state: State<'_, SearchState>,
    config: SearchConfig,
) -> Result<HealthStatus, String> {
    let pool = pool::create_pool(&config).await.map_err(|e| e.to_string())?;

    // Detect available extensions
    let (has_pgvector, has_vectorscale) =
        pool::detect_extensions(&pool).await.map_err(|e| e.to_string())?;

    if !has_pgvector {
        return Err("pgvector extension not available — required for search".into());
    }

    // Create extensions
    pool::ensure_extensions(&pool, has_vectorscale)
        .await
        .map_err(|e| e.to_string())?;

    // Initialize schema with best available index type
    let use_diskann = has_vectorscale;
    schema::initialize_schema(&pool, config.embedding_dim, use_diskann)
        .await
        .map_err(|e| e.to_string())?;

    let health = pool::health_check(&pool).await.map_err(|e| e.to_string())?;

    // Store the pool in state
    let mut session = state.inner.write().await;
    session.pool = Some(pool);
    session.config = Some(SearchConfig {
        has_vectorscale,
        ..config
    });

    Ok(health)
}

/// Disconnect from the search backend
#[tauri::command]
pub async fn search_disconnect(state: State<'_, SearchState>) -> Result<(), String> {
    let mut session = state.inner.write().await;
    if let Some(pool) = session.pool.take() {
        pool.close().await;
    }
    session.config = None;
    Ok(())
}

/// Health check on the search backend
#[tauri::command]
pub async fn search_health(state: State<'_, SearchState>) -> Result<HealthStatus, String> {
    let session = state.inner.read().await;
    let pool = session
        .pool
        .as_ref()
        .ok_or("Search backend not connected")?;
    pool::health_check(pool).await.map_err(|e| e.to_string())
}

/// Index a single document
#[tauri::command]
pub async fn search_index(
    state: State<'_, SearchState>,
    document: SearchDocument,
) -> Result<(), String> {
    let session = state.inner.read().await;
    let pool = session
        .pool
        .as_ref()
        .ok_or("Search backend not connected")?;
    search::index_document(pool, &document)
        .await
        .map_err(|e| e.to_string())
}

/// Batch index multiple documents
#[tauri::command]
pub async fn search_index_batch(
    state: State<'_, SearchState>,
    documents: Vec<SearchDocument>,
) -> Result<usize, String> {
    let session = state.inner.read().await;
    let pool = session
        .pool
        .as_ref()
        .ok_or("Search backend not connected")?;
    search::index_batch(pool, &documents)
        .await
        .map_err(|e| e.to_string())
}

/// Hybrid search: full-text + vector similarity
#[tauri::command]
pub async fn search_query(
    state: State<'_, SearchState>,
    query: SearchQuery,
) -> Result<Vec<SearchResult>, String> {
    let session = state.inner.read().await;
    let pool = session
        .pool
        .as_ref()
        .ok_or("Search backend not connected")?;
    search::hybrid_search(pool, &query)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a document by ID
#[tauri::command]
pub async fn search_delete(
    state: State<'_, SearchState>,
    id: String,
) -> Result<bool, String> {
    let session = state.inner.read().await;
    let pool = session
        .pool
        .as_ref()
        .ok_or("Search backend not connected")?;
    search::delete_document(pool, &id)
        .await
        .map_err(|e| e.to_string())
}

/// Delete documents by chain and/or type filter
#[tauri::command]
pub async fn search_delete_filter(
    state: State<'_, SearchState>,
    chain: Option<String>,
    doc_type: Option<String>,
) -> Result<u64, String> {
    let session = state.inner.read().await;
    let pool = session
        .pool
        .as_ref()
        .ok_or("Search backend not connected")?;
    search::delete_by_filter(pool, chain.as_deref(), doc_type.as_deref())
        .await
        .map_err(|e| e.to_string())
}
