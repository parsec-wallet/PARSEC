// PARSEC Wallet — parsec_search IPC client
// PostgreSQL + pgvectorscale hybrid search engine.
// All search operations go through Tauri invoke → Rust → PostgreSQL.

import { invoke } from './platform';

// --- Types ---

export interface SearchConfig {
  database_url: string;
  max_connections: number;
  embedding_dim: number;
  has_vectorscale: boolean;
  use_hnsw_fallback: boolean;
}

export interface HealthStatus {
  connected: boolean;
  pg_version: string;
  pool_size: number;
  idle_connections: number;
  has_pgvector: boolean;
  has_vectorscale: boolean;
}

export interface SearchDocument {
  id: string;
  doc_type: string;
  chain: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export interface SearchResult {
  id: string;
  doc_type: string;
  chain: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
  vector_distance: number | null;
  text_rank: number | null;
}

export interface SearchQuery {
  text?: string;
  embedding?: number[];
  doc_type?: string;
  chain?: string;
  limit?: number;
  metadata_filter?: Record<string, unknown>;
  text_weight?: number;
}

// --- IPC ---

/** Connect to PostgreSQL and initialize search schema */
export async function searchConnect(config: SearchConfig): Promise<HealthStatus> {
  return await invoke<HealthStatus>('search_connect', { config });
}

/** Disconnect from search backend */
export async function searchDisconnect(): Promise<void> {
  await invoke('search_disconnect');
}

/** Health check */
export async function searchHealth(): Promise<HealthStatus> {
  return await invoke<HealthStatus>('search_health');
}

/** Index a single document */
export async function searchIndex(document: SearchDocument): Promise<void> {
  await invoke('search_index', { document });
}

/** Batch index documents */
export async function searchIndexBatch(documents: SearchDocument[]): Promise<number> {
  return await invoke<number>('search_index_batch', { documents });
}

/** Hybrid search: full-text + vector similarity */
export async function searchQuery(query: SearchQuery): Promise<SearchResult[]> {
  return await invoke<SearchResult[]>('search_query', { query });
}

/** Delete a document by ID */
export async function searchDelete(id: string): Promise<boolean> {
  return await invoke<boolean>('search_delete', { id });
}

/** Delete documents by chain and/or type */
export async function searchDeleteFilter(chain?: string, docType?: string): Promise<number> {
  return await invoke<number>('search_delete_filter', { chain, docType });
}
