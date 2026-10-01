// Parsec Wallet — parsec_throttle IPC client
// Resource-aware API rate limiting with energy cost tracking.

import { invoke } from './platform';

// --- Types ---

export interface ThrottleConfig {
  global_rps: number;
  per_source_rps: number;
  burst_multiplier: number;
  dynamic_adjustment: boolean;
  min_throttle_factor: number;
  cost_per_request_mwh: number;
  cost_per_mb_mwh: number;
}

export interface ThrottleDecision {
  allowed: boolean;
  remaining_tokens: number;
  retry_after_ms: number | null;
  throttle_factor: number;
  energy_cost_mwh: number;
}

export interface LimiterStats {
  source_id: string;
  tokens_remaining: number;
  refill_rate: number;
  total_allowed: number;
  total_denied: number;
  total_bytes: number;
  deny_ratio: number;
}

// --- IPC ---

/** Initialize the throttle engine */
export async function throttleInit(config: ThrottleConfig): Promise<void> {
  await invoke('throttle_init', { config });
}

/** Check if a request from a source should be allowed */
export async function throttleCheck(sourceId: string, bytes?: number): Promise<ThrottleDecision> {
  return await invoke<ThrottleDecision>('throttle_check', {
    sourceId,
    bytes: bytes ?? null,
  });
}

/** Get stats for all rate limiters */
export async function throttleStats(): Promise<LimiterStats[]> {
  return await invoke<LimiterStats[]>('throttle_stats');
}

/** Update throttle configuration */
export async function throttleUpdateConfig(config: ThrottleConfig): Promise<void> {
  await invoke('throttle_update_config', { config });
}

/** Reset a specific source's rate limiter */
export async function throttleResetSource(sourceId: string): Promise<void> {
  await invoke('throttle_reset_source', { sourceId });
}

/** Reset all rate limiters */
export async function throttleResetAll(): Promise<void> {
  await invoke('throttle_reset_all');
}
