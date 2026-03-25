//! Resource mapping: CPU, bandwidth, storage, electricity → crypto exchange rates
//!
//! Maps physical resources to economic value for fair P2P exchange.
//! Electricity cost is the base unit: everything reduces to watts consumed.
//!
//! Formula: resource_value = power_draw * duration_hours * electricity_cost_kwh / 1000
//!
//! This enables realistic throttling: a peer contributing 50W of compute for 1 hour
//! at $0.12/kWh has contributed ~$0.006 worth of electricity, which maps to a
//! proportional crypto credit.

use serde::{Deserialize, Serialize};
use std::time::SystemTime;

use super::ResourceMap;

/// Snapshot of local system resources
pub fn snapshot_resources() -> ResourceMap {
    // CPU info from /proc/stat or sysinfo crate equivalent
    let cpu_cores = num_cpus_available();
    let cpu_usage = cpu_usage_percent();
    let (ram_total, ram_available) = memory_info();
    let disk_available = disk_free();
    let (bw_up, bw_down) = estimated_bandwidth();
    let power = estimate_power_draw(cpu_usage, cpu_cores);

    ResourceMap {
        cpu_cores,
        cpu_usage_pct: cpu_usage,
        ram_available,
        disk_available,
        bandwidth_up: bw_up,
        bandwidth_down: bw_down,
        power_draw_watts: power,
        electricity_cost_kwh: 0.12, // Default, overridden by user config
    }
}

/// Calculate the crypto-equivalent value of resources consumed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceCost {
    /// Duration in seconds
    pub duration_secs: f64,
    /// Average power draw during the period
    pub avg_power_watts: f64,
    /// Electricity cost per kWh
    pub cost_per_kwh: f64,
    /// Total energy consumed (kWh)
    pub energy_kwh: f64,
    /// Dollar value of electricity consumed
    pub cost_usd: f64,
    /// Bandwidth consumed (bytes)
    pub bandwidth_bytes: u64,
    /// Bandwidth cost component (at current ISP rates)
    pub bandwidth_cost_usd: f64,
    /// Total resource cost in USD equivalent
    pub total_cost_usd: f64,
}

/// Compute the resource cost for a given work period
pub fn compute_resource_cost(
    duration_secs: f64,
    avg_power_watts: f64,
    cost_per_kwh: f64,
    bandwidth_bytes: u64,
    bandwidth_cost_per_gb: f64,
) -> ResourceCost {
    let hours = duration_secs / 3600.0;
    let energy_kwh = (avg_power_watts * hours) / 1000.0;
    let electricity_cost = energy_kwh * cost_per_kwh;

    let gb = bandwidth_bytes as f64 / 1_073_741_824.0;
    let bandwidth_cost = gb * bandwidth_cost_per_gb;

    let total = electricity_cost + bandwidth_cost;

    ResourceCost {
        duration_secs,
        avg_power_watts,
        cost_per_kwh,
        energy_kwh,
        cost_usd: electricity_cost,
        bandwidth_bytes,
        bandwidth_cost_usd: bandwidth_cost,
        total_cost_usd: total,
    }
}

/// Rate limiter based on resource budget — returns allowed bytes/sec
pub fn compute_throttle(
    current_resources: &ResourceMap,
    max_cpu_pct: u8,
    max_bandwidth: u64,
    max_power_watts: f64,
) -> ThrottleParams {
    // CPU throttle: if current usage + mesh share exceeds budget, reduce
    let available_cpu_pct = (max_cpu_pct as f64).min(100.0 - current_resources.cpu_usage_pct);
    let cpu_throttle = (available_cpu_pct / 100.0).clamp(0.0, 1.0);

    // Bandwidth throttle: cap to budget
    let bw_throttle = if max_bandwidth == 0 {
        1.0
    } else {
        let current_total = current_resources.bandwidth_up + current_resources.bandwidth_down;
        if current_total >= max_bandwidth {
            0.0
        } else {
            (max_bandwidth - current_total) as f64 / max_bandwidth as f64
        }
    };

    // Power throttle: if estimated draw exceeds budget, reduce
    let power_throttle = if max_power_watts <= 0.0 {
        1.0
    } else {
        (max_power_watts / current_resources.power_draw_watts.max(1.0)).clamp(0.0, 1.0)
    };

    // Combined throttle: take the most restrictive
    let combined = cpu_throttle.min(bw_throttle).min(power_throttle);

    ThrottleParams {
        cpu_throttle,
        bandwidth_throttle: bw_throttle,
        power_throttle,
        combined_throttle: combined,
        allowed_bandwidth_bps: (max_bandwidth as f64 * bw_throttle) as u64,
        allowed_cpu_pct: (max_cpu_pct as f64 * cpu_throttle) as u8,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThrottleParams {
    /// CPU throttle factor (0.0 = blocked, 1.0 = full)
    pub cpu_throttle: f64,
    /// Bandwidth throttle factor
    pub bandwidth_throttle: f64,
    /// Power throttle factor
    pub power_throttle: f64,
    /// Combined minimum throttle
    pub combined_throttle: f64,
    /// Allowed bandwidth in bytes per second
    pub allowed_bandwidth_bps: u64,
    /// Allowed CPU percentage for mesh tasks
    pub allowed_cpu_pct: u8,
}

// --- System info helpers (Linux-first, with fallbacks) ---

fn num_cpus_available() -> f64 {
    std::thread::available_parallelism()
        .map(|n| n.get() as f64)
        .unwrap_or(1.0)
}

fn cpu_usage_percent() -> f64 {
    // Read from /proc/loadavg — 1-minute load average / num_cpus * 100
    if let Ok(loadavg) = std::fs::read_to_string("/proc/loadavg") {
        if let Some(load_str) = loadavg.split_whitespace().next() {
            if let Ok(load) = load_str.parse::<f64>() {
                let cpus = num_cpus_available();
                return ((load / cpus) * 100.0).clamp(0.0, 100.0);
            }
        }
    }
    50.0 // Fallback estimate
}

fn memory_info() -> (u64, u64) {
    // Parse /proc/meminfo
    if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
        let mut total: u64 = 0;
        let mut available: u64 = 0;
        for line in meminfo.lines() {
            if line.starts_with("MemTotal:") {
                total = parse_meminfo_kb(line) * 1024;
            } else if line.starts_with("MemAvailable:") {
                available = parse_meminfo_kb(line) * 1024;
            }
        }
        return (total, available);
    }
    (0, 0)
}

fn parse_meminfo_kb(line: &str) -> u64 {
    line.split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
}

fn disk_free() -> u64 {
    // Use statvfs on the home directory
    #[cfg(target_os = "linux")]
    {
        use std::ffi::CString;
        use std::mem::MaybeUninit;

        if let Ok(home) = std::env::var("HOME") {
            if let Ok(path) = CString::new(home) {
                let mut stat = MaybeUninit::<libc::statvfs>::uninit();
                unsafe {
                    if libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) == 0 {
                        let stat = stat.assume_init();
                        return stat.f_bavail * stat.f_bsize;
                    }
                }
            }
        }
    }
    0
}

fn estimated_bandwidth() -> (u64, u64) {
    // Read /proc/net/dev for total bytes, estimate rate from delta
    // For initial implementation, return conservative defaults
    // TODO: implement delta-based bandwidth estimation with sampling
    (10_485_760, 52_428_800) // 10 MB/s up, 50 MB/s down default
}

fn estimate_power_draw(cpu_usage_pct: f64, cpu_cores: f64) -> f64 {
    // Rough estimation: base 10W + (cpu_usage * cores * 5W per core at full load)
    // This is intentionally conservative. Users can override via config.
    let base_watts = 10.0;
    let per_core_max = 5.0;
    base_watts + (cpu_usage_pct / 100.0) * cpu_cores * per_core_max
}
