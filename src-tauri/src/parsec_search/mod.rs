//! parsec_search — Sovereign search engine backed by PostgreSQL + pgvectorscale
//!
//! Replaces Elasticsearch with PostgreSQL's pgvector + pgvectorscale extensions.
//! Uses StreamingDiskANN indexes for high-performance vector similarity search
//! alongside standard full-text search (tsvector/tsquery).
//!
//! Design: web2 PostgreSQL is abundant, has good bandwidth, and is already
//! deployed everywhere. We use it as the unified search backend.

pub mod commands;
pub mod persist;
pub mod pool;
pub mod schema;
pub mod search;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Connection pool state managed by Tauri
pub struct SearchState {
    pub inner: Arc<RwLock<SearchSession>>,
}

impl Default for SearchState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(SearchSession::default())),
        }
    }
}

/// Active search session holding the connection pool
#[derive(Default)]
pub struct SearchSession {
    pub pool: Option<sqlx::PgPool>,
    pub config: Option<SearchConfig>,
}

/// Configuration for the search backend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchConfig {
    /// PostgreSQL connection string (e.g. postgres://user:pass@localhost:5432/parsec)
    pub database_url: String,
    /// Maximum connections in the pool
    pub max_connections: u32,
    /// Vector embedding dimension (default 384 for small models)
    pub embedding_dim: u32,
    /// Whether pgvectorscale is available (enables DiskANN indexes)
    pub has_vectorscale: bool,
    /// Whether to use pgvector HNSW fallback if vectorscale unavailable
    pub use_hnsw_fallback: bool,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            database_url: String::new(),
            max_connections: 10,
            embedding_dim: 384,
            has_vectorscale: false,
            use_hnsw_fallback: true,
        }
    }
}

/// A searchable document stored in the index
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDocument {
    pub id: String,
    /// Document type: "chain", "asset", "tx", "dapp", "address", "contract"
    pub doc_type: String,
    /// Chain identifier: "algorand", "ethereum", "bitcoin", "solana", "cosmos"
    pub chain: String,
    /// Human-readable content for full-text search
    pub content: String,
    /// Structured metadata as JSON
    pub metadata: serde_json::Value,
    /// Optional vector embedding for semantic search
    pub embedding: Option<Vec<f32>>,
}

/// Search result with relevance scoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub doc_type: String,
    pub chain: String,
    pub content: String,
    pub metadata: serde_json::Value,
    /// Combined relevance score (text + vector)
    pub score: f64,
    /// Vector similarity distance (lower = more similar)
    pub vector_distance: Option<f64>,
    /// Full-text rank
    pub text_rank: Option<f64>,
}

/// Search query parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    /// Free-text query (triggers tsvector search)
    pub text: Option<String>,
    /// Vector embedding for semantic search
    pub embedding: Option<Vec<f32>>,
    /// Filter by document type
    pub doc_type: Option<String>,
    /// Filter by chain
    pub chain: Option<String>,
    /// Maximum results to return
    pub limit: Option<i64>,
    /// Metadata filter (JSONB containment)
    pub metadata_filter: Option<serde_json::Value>,
    /// Weight: how much to favor text vs vector (0.0 = all vector, 1.0 = all text)
    pub text_weight: Option<f64>,
}
