//! parsec_throttle — Resource-aware API rate limiting and throttle controls
//!
//! Maps processor utilization, bandwidth consumption, and electricity exchange
//! to API rate limits. Every external request (from dApps, peers, or relays)
//! is metered against the node's resource budget.
//!
//! The throttle is the bridge between physical reality and digital APIs:
//! - CPU cycles cost electricity
//! - Bandwidth costs money
//! - Storage costs disk and power
//! - All of this maps to crypto exchange value
//!
//! Rate limiting uses a token bucket with dynamic refill rates based on
//! the current resource snapshot.

pub mod commands;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Throttle state managed by Tauri
pub struct ThrottleState {
    pub inner: Arc<RwLock<ThrottleEngine>>,
}

impl Default for ThrottleState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(ThrottleEngine::default())),
        }
    }
}

/// The throttle engine managing all rate limiters
#[derive(Default)]
pub struct ThrottleEngine {
    /// Per-source rate limiters (keyed by dapp_id, peer_id, or IP)
    pub limiters: HashMap<String, TokenBucket>,
    /// Global rate limiter
    pub global: Option<TokenBucket>,
    /// Configuration
    pub config: ThrottleConfig,
    /// Metrics accumulator
    pub metrics: Vec<ThrottleMetric>,
}

/// Throttle configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThrottleConfig {
    /// Global requests per second limit
    pub global_rps: f64,
    /// Per-source requests per second limit
    pub per_source_rps: f64,
    /// Burst multiplier (how many tokens above steady state)
    pub burst_multiplier: f64,
    /// Whether to dynamically adjust limits based on resources
    pub dynamic_adjustment: bool,
    /// Minimum throttle factor (never go below this, even under load)
    pub min_throttle_factor: f64,
    /// Cost per request in milliwatt-hours (for exchange accounting)
    pub cost_per_request_mwh: f64,
    /// Cost per MB transferred in milliwatt-hours
    pub cost_per_mb_mwh: f64,
}

impl Default for ThrottleConfig {
    fn default() -> Self {
        Self {
            global_rps: 100.0,
            per_source_rps: 20.0,
            burst_multiplier: 3.0,
            dynamic_adjustment: true,
            min_throttle_factor: 0.1,
            cost_per_request_mwh: 0.5,
            cost_per_mb_mwh: 2.0,
        }
    }
}

/// Token bucket rate limiter
#[derive(Debug, Clone)]
pub struct TokenBucket {
    /// Current tokens available
    pub tokens: f64,
    /// Maximum tokens (burst capacity)
    pub max_tokens: f64,
    /// Tokens added per second (refill rate)
    pub refill_rate: f64,
    /// Last time tokens were refilled
    pub last_refill: Instant,
    /// Total requests allowed
    pub total_allowed: u64,
    /// Total requests denied
    pub total_denied: u64,
    /// Total bytes transferred through this bucket
    pub total_bytes: u64,
}

impl TokenBucket {
    pub fn new(rps: f64, burst_multiplier: f64) -> Self {
        let max_tokens = rps * burst_multiplier;
        Self {
            tokens: max_tokens,
            max_tokens,
            refill_rate: rps,
            last_refill: Instant::now(),
            total_allowed: 0,
            total_denied: 0,
            total_bytes: 0,
        }
    }

    /// Attempt to consume one token. Returns true if allowed.
    pub fn try_acquire(&mut self) -> bool {
        self.refill();
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            self.total_allowed += 1;
            true
        } else {
            self.total_denied += 1;
            false
        }
    }

    /// Attempt to consume tokens proportional to size (for bandwidth)
    pub fn try_acquire_bytes(&mut self, bytes: u64) -> bool {
        self.refill();
        // 1 token per KB
        let cost = (bytes as f64) / 1024.0;
        if self.tokens >= cost {
            self.tokens -= cost;
            self.total_allowed += 1;
            self.total_bytes += bytes;
            true
        } else {
            self.total_denied += 1;
            false
        }
    }

    /// Dynamically adjust the refill rate based on a throttle factor (0.0 to 1.0)
    pub fn adjust_rate(&mut self, factor: f64) {
        self.refill_rate = self.refill_rate * factor.clamp(0.01, 1.0);
        self.max_tokens = self.refill_rate * 3.0; // Maintain burst ratio
    }

    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_rate).min(self.max_tokens);
        self.last_refill = now;
    }
}

/// A throttle check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThrottleDecision {
    /// Whether the request is allowed
    pub allowed: bool,
    /// Remaining tokens for this source
    pub remaining_tokens: f64,
    /// Estimated wait time in milliseconds if denied
    pub retry_after_ms: Option<u64>,
    /// Current throttle factor (1.0 = no throttling, 0.0 = fully blocked)
    pub throttle_factor: f64,
    /// Estimated energy cost of this request in milliwatt-hours
    pub energy_cost_mwh: f64,
}

/// A recorded throttle metric
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThrottleMetric {
    pub source_id: String,
    pub metric_type: String,
    pub value: f64,
    pub unit: String,
    pub timestamp: u64,
}

/// Statistics for a rate limiter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimiterStats {
    pub source_id: String,
    pub tokens_remaining: f64,
    pub refill_rate: f64,
    pub total_allowed: u64,
    pub total_denied: u64,
    pub total_bytes: u64,
    pub deny_ratio: f64,
}

impl ThrottleEngine {
    /// Check if a request from a given source should be allowed
    pub fn check_request(&mut self, source_id: &str, bytes: Option<u64>) -> ThrottleDecision {
        // Check global limiter first
        if let Some(ref mut global) = self.global {
            if !global.try_acquire() {
                return ThrottleDecision {
                    allowed: false,
                    remaining_tokens: global.tokens,
                    retry_after_ms: Some((1000.0 / global.refill_rate) as u64),
                    throttle_factor: 0.0,
                    energy_cost_mwh: 0.0,
                };
            }
        }

        // Get or create per-source limiter
        let limiter = self
            .limiters
            .entry(source_id.to_string())
            .or_insert_with(|| {
                TokenBucket::new(self.config.per_source_rps, self.config.burst_multiplier)
            });

        let allowed = match bytes {
            Some(b) => limiter.try_acquire_bytes(b),
            None => limiter.try_acquire(),
        };

        let energy_cost = self.config.cost_per_request_mwh
            + bytes.unwrap_or(0) as f64 / 1_048_576.0 * self.config.cost_per_mb_mwh;

        let retry_after = if !allowed {
            Some((1000.0 / limiter.refill_rate) as u64)
        } else {
            None
        };

        ThrottleDecision {
            allowed,
            remaining_tokens: limiter.tokens,
            retry_after_ms: retry_after,
            throttle_factor: limiter.refill_rate / self.config.per_source_rps,
            energy_cost_mwh: energy_cost,
        }
    }

    /// Get stats for all limiters
    pub fn all_stats(&self) -> Vec<LimiterStats> {
        self.limiters
            .iter()
            .map(|(id, l)| LimiterStats {
                source_id: id.clone(),
                tokens_remaining: l.tokens,
                refill_rate: l.refill_rate,
                total_allowed: l.total_allowed,
                total_denied: l.total_denied,
                total_bytes: l.total_bytes,
                deny_ratio: if l.total_allowed + l.total_denied > 0 {
                    l.total_denied as f64 / (l.total_allowed + l.total_denied) as f64
                } else {
                    0.0
                },
            })
            .collect()
    }

    /// Initialize the global limiter
    pub fn init_global(&mut self) {
        self.global = Some(TokenBucket::new(
            self.config.global_rps,
            self.config.burst_multiplier,
        ));
    }
}
