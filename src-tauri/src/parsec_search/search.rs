//! Hybrid search engine: full-text (tsvector) + vector (pgvectorscale/pgvector)
//!
//! Queries combine text relevance and vector similarity into a unified score.
//! The text_weight parameter controls the blend (0.0 = pure vector, 1.0 = pure text).

use anyhow::{Context, Result};
use sqlx::PgPool;

use super::{SearchDocument, SearchQuery, SearchResult};

/// Index a document (upsert)
pub async fn index_document(pool: &PgPool, doc: &SearchDocument) -> Result<()> {
    let embedding_json: Option<String> = doc.embedding.as_ref().map(|e| {
        format!(
            "[{}]",
            e.iter()
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
                .join(",")
        )
    });

    sqlx::query(
        r#"
        INSERT INTO parsec_documents (id, doc_type, chain, content, metadata, embedding)
        VALUES ($1, $2, $3, $4, $5, $6::vector)
        ON CONFLICT (id) DO UPDATE SET
            doc_type = EXCLUDED.doc_type,
            chain = EXCLUDED.chain,
            content = EXCLUDED.content,
            metadata = EXCLUDED.metadata,
            embedding = EXCLUDED.embedding,
            updated_at = now()
        "#,
    )
    .bind(&doc.id)
    .bind(&doc.doc_type)
    .bind(&doc.chain)
    .bind(&doc.content)
    .bind(&doc.metadata)
    .bind(&embedding_json)
    .execute(pool)
    .await
    .context("Failed to index document")?;

    Ok(())
}

/// Batch index multiple documents
pub async fn index_batch(pool: &PgPool, docs: &[SearchDocument]) -> Result<usize> {
    let mut count = 0;
    for doc in docs {
        index_document(pool, doc).await?;
        count += 1;
    }
    Ok(count)
}

/// Hybrid search combining full-text and vector similarity
pub async fn hybrid_search(pool: &PgPool, query: &SearchQuery) -> Result<Vec<SearchResult>> {
    let limit = query.limit.unwrap_or(20);
    let text_weight = query.text_weight.unwrap_or(0.5);

    let has_text = query.text.is_some();
    let has_vector = query.embedding.is_some();

    if !has_text && !has_vector {
        // No query — return recent documents
        return recent_documents(pool, query, limit).await;
    }

    let embedding_str: Option<String> = query.embedding.as_ref().map(|e| {
        format!(
            "[{}]",
            e.iter()
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
                .join(",")
        )
    });

    // Build the hybrid query dynamically based on what's provided
    let sql = build_hybrid_sql(has_text, has_vector, text_weight, query);

    let mut q = sqlx::query_as::<_, SearchRow>(&sql);

    // Bind parameters in order
    if has_text {
        q = q.bind(query.text.as_ref().unwrap());
    }
    if has_vector {
        q = q.bind(embedding_str.as_ref().unwrap());
    }
    if let Some(ref doc_type) = query.doc_type {
        q = q.bind(doc_type);
    }
    if let Some(ref chain) = query.chain {
        q = q.bind(chain);
    }
    if let Some(ref meta) = query.metadata_filter {
        q = q.bind(meta);
    }
    q = q.bind(limit);

    let rows = q.fetch_all(pool).await.context("Hybrid search failed")?;

    Ok(rows
        .into_iter()
        .map(|r| SearchResult {
            id: r.id,
            doc_type: r.doc_type,
            chain: r.chain,
            content: r.content,
            metadata: r.metadata,
            score: r.score,
            vector_distance: r.vector_distance,
            text_rank: r.text_rank,
        })
        .collect())
}

/// Delete a document by ID
pub async fn delete_document(pool: &PgPool, id: &str) -> Result<bool> {
    let result = sqlx::query("DELETE FROM parsec_documents WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .context("Failed to delete document")?;

    Ok(result.rows_affected() > 0)
}

/// Delete all documents matching a chain + doc_type filter
pub async fn delete_by_filter(
    pool: &PgPool,
    chain: Option<&str>,
    doc_type: Option<&str>,
) -> Result<u64> {
    let mut sql = String::from("DELETE FROM parsec_documents WHERE 1=1");
    let mut param_idx = 1;

    if chain.is_some() {
        sql.push_str(&format!(" AND chain = ${param_idx}"));
        param_idx += 1;
    }
    if doc_type.is_some() {
        sql.push_str(&format!(" AND doc_type = ${param_idx}"));
    }

    let mut q = sqlx::query(&sql);
    if let Some(c) = chain {
        q = q.bind(c);
    }
    if let Some(dt) = doc_type {
        q = q.bind(dt);
    }

    let result = q.execute(pool).await.context("Failed to delete by filter")?;
    Ok(result.rows_affected())
}

// --- internal ---

#[derive(sqlx::FromRow)]
struct SearchRow {
    id: String,
    doc_type: String,
    chain: String,
    content: String,
    metadata: serde_json::Value,
    score: f64,
    vector_distance: Option<f64>,
    text_rank: Option<f64>,
}

fn build_hybrid_sql(
    has_text: bool,
    has_vector: bool,
    text_weight: f64,
    query: &SearchQuery,
) -> String {
    let mut param_idx: usize = 1;
    let mut select_parts = vec![
        "id".to_string(),
        "doc_type".to_string(),
        "chain".to_string(),
        "content".to_string(),
        "metadata".to_string(),
    ];
    let mut where_clauses: Vec<String> = vec![];

    // Text scoring
    let text_score = if has_text {
        let idx = param_idx;
        param_idx += 1;
        where_clauses.push(format!(
            "search_vector @@ plainto_tsquery('english', ${idx})"
        ));
        format!(
            "ts_rank_cd(search_vector, plainto_tsquery('english', ${idx}))",
        )
    } else {
        "0.0".to_string()
    };

    // Vector scoring
    let vector_score = if has_vector {
        let idx = param_idx;
        param_idx += 1;
        // Cosine distance: lower = more similar. Convert to similarity: 1 - distance
        format!("(1.0 - (embedding <=> ${idx}::vector))")
    } else {
        "0.0".to_string()
    };

    // Combined score
    let vector_weight = 1.0 - text_weight;
    let combined_score = format!(
        "({tw} * COALESCE({text}, 0.0) + {vw} * COALESCE({vec}, 0.0)) AS score",
        tw = text_weight,
        text = text_score,
        vw = vector_weight,
        vec = vector_score
    );
    select_parts.push(combined_score);

    // Individual scores for transparency
    if has_vector {
        select_parts.push(format!("(embedding <=> ${}::vector) AS vector_distance", if has_text { 2 } else { 1 }));
    } else {
        select_parts.push("NULL::float8 AS vector_distance".to_string());
    }
    if has_text {
        select_parts.push(format!(
            "ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS text_rank"
        ));
    } else {
        select_parts.push("NULL::float8 AS text_rank".to_string());
    }

    // Filter clauses
    if let Some(_) = &query.doc_type {
        where_clauses.push(format!("doc_type = ${param_idx}"));
        param_idx += 1;
    }
    if let Some(_) = &query.chain {
        where_clauses.push(format!("chain = ${param_idx}"));
        param_idx += 1;
    }
    if let Some(_) = &query.metadata_filter {
        where_clauses.push(format!("metadata @> ${param_idx}"));
        param_idx += 1;
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    format!(
        "SELECT {selects} FROM parsec_documents {where_sql} ORDER BY score DESC LIMIT ${param_idx}",
        selects = select_parts.join(", "),
    )
}

async fn recent_documents(
    pool: &PgPool,
    query: &SearchQuery,
    limit: i64,
) -> Result<Vec<SearchResult>> {
    let mut sql =
        String::from("SELECT id, doc_type, chain, content, metadata FROM parsec_documents");
    let mut where_clauses: Vec<String> = vec![];
    let mut param_idx = 1;

    if let Some(_) = &query.doc_type {
        where_clauses.push(format!("doc_type = ${param_idx}"));
        param_idx += 1;
    }
    if let Some(_) = &query.chain {
        where_clauses.push(format!("chain = ${param_idx}"));
        param_idx += 1;
    }

    if !where_clauses.is_empty() {
        sql.push_str(&format!(" WHERE {}", where_clauses.join(" AND ")));
    }
    sql.push_str(&format!(" ORDER BY updated_at DESC LIMIT ${param_idx}"));

    let mut q = sqlx::query_as::<_, RecentRow>(&sql);
    if let Some(ref dt) = query.doc_type {
        q = q.bind(dt);
    }
    if let Some(ref c) = query.chain {
        q = q.bind(c);
    }
    q = q.bind(limit);

    let rows = q.fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|r| SearchResult {
            id: r.id,
            doc_type: r.doc_type,
            chain: r.chain,
            content: r.content,
            metadata: r.metadata,
            score: 0.0,
            vector_distance: None,
            text_rank: None,
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct RecentRow {
    id: String,
    doc_type: String,
    chain: String,
    content: String,
    metadata: serde_json::Value,
}
