//! Embedded HTTP server: makes every Parsec client also a server
//!
//! Serves a lightweight API that other peers can query for:
//! - Resource availability
//! - Content handoff requests
//! - Search relay (delegated queries)
//! - Peer discovery announcements
//!
//! Uses axum for minimal footprint. Rate-limited by token bucket.
//! Rate limit headers on every response per cypherpunk2048 standard.

use anyhow::Result;
use axum::{
    body::Body,
    extract::State as AxumState,
    http::{Request, Response, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use super::resource;
use super::ResourceBudget;

/// Server state shared across handlers
pub struct ServerState {
    pub resource_budget: Arc<RwLock<ResourceBudget>>,
    pub request_count: Arc<std::sync::atomic::AtomicU64>,
    pub rate_limiters: Arc<RwLock<RateLimiterMap>>,
}

/// Per-IP token bucket rate limiters
pub struct RateLimiterMap {
    buckets: HashMap<String, TokenBucket>,
    /// Requests per second per IP
    rps: f64,
    /// Burst multiplier
    burst: f64,
}

impl Default for RateLimiterMap {
    fn default() -> Self {
        Self {
            buckets: HashMap::new(),
            rps: 20.0,
            burst: 3.0,
        }
    }
}

struct TokenBucket {
    tokens: f64,
    max_tokens: f64,
    refill_rate: f64,
    last_refill: Instant,
}

impl TokenBucket {
    fn new(rps: f64, burst: f64) -> Self {
        let max = rps * burst;
        Self {
            tokens: max,
            max_tokens: max,
            refill_rate: rps,
            last_refill: Instant::now(),
        }
    }

    fn try_acquire(&mut self) -> (bool, f64, u64) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_rate).min(self.max_tokens);
        self.last_refill = now;

        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            (true, self.tokens, 0)
        } else {
            let retry_ms = ((1.0 - self.tokens) / self.refill_rate * 1000.0) as u64;
            (false, self.tokens, retry_ms)
        }
    }
}

impl RateLimiterMap {
    fn check(&mut self, ip: &str) -> (bool, f64, u64) {
        let bucket = self
            .buckets
            .entry(ip.to_string())
            .or_insert_with(|| TokenBucket::new(self.rps, self.burst));
        bucket.try_acquire()
    }
}

/// Rate limiting middleware — adds headers to every response
async fn rate_limit_middleware(
    AxumState(state): AxumState<Arc<ServerState>>,
    req: Request<Body>,
    next: Next,
) -> Response<Body> {
    // Extract IP from connection info or X-Forwarded-For
    let ip = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        .unwrap_or_else(|| "unknown".into());

    let (allowed, remaining, retry_after) = {
        let mut limiters = state.rate_limiters.write().await;
        limiters.check(&ip)
    };

    if !allowed {
        let mut resp = Response::builder()
            .status(StatusCode::TOO_MANY_REQUESTS)
            .header("X-RateLimit-Remaining", "0")
            .header("X-RateLimit-Retry-After-Ms", retry_after.to_string())
            .header("Retry-After", ((retry_after + 999) / 1000).to_string())
            .body(Body::from("Rate limit exceeded"))
            .unwrap();

        return resp;
    }

    // Track request
    state
        .request_count
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let mut response = next.run(req).await;

    // Add rate limit headers to every response
    let headers = response.headers_mut();
    headers.insert(
        "X-RateLimit-Remaining",
        (remaining as u64).to_string().parse().unwrap(),
    );
    headers.insert("X-Parsec-Version", env!("CARGO_PKG_VERSION").parse().unwrap());

    response
}

/// Start the embedded peer server on the given port
pub async fn start_server(port: u16, budget: Arc<RwLock<ResourceBudget>>) -> Result<()> {
    let state = Arc::new(ServerState {
        resource_budget: budget,
        request_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        rate_limiters: Arc::new(RwLock::new(RateLimiterMap::default())),
    });

    let app = Router::new()
        .route("/parsec/v1/health", get(health_handler))
        .route("/parsec/v1/resources", get(resources_handler))
        .route("/parsec/v1/announce", post(announce_handler))
        .route("/parsec/v1/handoff", post(handoff_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            rate_limit_middleware,
        ))
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Health endpoint — proves this peer is alive
async fn health_handler(
    AxumState(state): AxumState<Arc<ServerState>>,
) -> Json<HealthResponse> {
    let count = state
        .request_count
        .load(std::sync::atomic::Ordering::Relaxed);

    Json(HealthResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        requests_served: count,
    })
}

/// Resource availability endpoint — tells peers what we can offer
async fn resources_handler(
    AxumState(state): AxumState<Arc<ServerState>>,
) -> Json<ResourceResponse> {
    let snapshot = resource::snapshot_resources();
    let budget = state.resource_budget.read().await;

    let throttle = resource::compute_throttle(
        &snapshot,
        budget.max_cpu_share_pct,
        budget.max_bandwidth_share,
        budget.max_power_watts,
    );

    Json(ResourceResponse {
        resources: snapshot,
        throttle,
        available: true,
    })
}

/// Peer announcement — another node says hello
async fn announce_handler(
    Json(payload): Json<AnnouncePayload>,
) -> Result<Json<AnnounceResponse>, StatusCode> {
    // TODO: verify payload.signature against payload.public_key
    Ok(Json(AnnounceResponse {
        accepted: true,
        message: "Peer registered".into(),
    }))
}

/// Content handoff request — peer wants us to serve or accept content
async fn handoff_handler(
    AxumState(state): AxumState<Arc<ServerState>>,
    Json(payload): Json<HandoffRequest>,
) -> Result<Json<HandoffResponse>, StatusCode> {
    let budget = state.resource_budget.read().await;

    if payload.size_bytes > budget.max_storage_share {
        return Ok(Json(HandoffResponse {
            accepted: false,
            reason: Some("Exceeds storage budget".into()),
            cid: None,
        }));
    }

    Ok(Json(HandoffResponse {
        accepted: true,
        reason: None,
        cid: Some(payload.cid),
    }))
}

// --- API types ---

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
    requests_served: u64,
}

#[derive(Serialize)]
struct ResourceResponse {
    resources: super::ResourceMap,
    throttle: resource::ThrottleParams,
    available: bool,
}

#[derive(Deserialize)]
struct AnnouncePayload {
    #[allow(dead_code)]
    peer_id: String,
    #[allow(dead_code)]
    public_key: String,
    #[allow(dead_code)]
    addresses: Vec<String>,
    #[allow(dead_code)]
    signature: String,
}

#[derive(Serialize)]
struct AnnounceResponse {
    accepted: bool,
    message: String,
}

#[derive(Deserialize)]
struct HandoffRequest {
    cid: String,
    size_bytes: u64,
    #[allow(dead_code)]
    origin_peer: String,
    #[allow(dead_code)]
    signature: String,
}

#[derive(Serialize)]
struct HandoffResponse {
    accepted: bool,
    reason: Option<String>,
    cid: Option<String>,
}
