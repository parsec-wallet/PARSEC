//! network_monitor — opt-in, read-only local network + system snapshot.
//!
//! **Off by default.** The `enabled` gate starts `false`; `network_info`
//! refuses until the participant turns monitoring on. Every reading is
//! computed fresh on each call — nothing is cached or persisted.

pub mod commands;

use serde::Serialize;
use std::sync::atomic::AtomicBool;

/// Gate for the monitor. Off by default — must be explicitly enabled.
pub struct NetworkMonitorState {
    pub enabled: AtomicBool,
}

impl Default for NetworkMonitorState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(false),
        }
    }
}

/// One local network interface.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceInfo {
    pub name: String,
    pub ipv4: Vec<String>,
    pub ipv6: Vec<String>,
    pub mac: Option<String>,
    pub index: u32,
}

/// CPU snapshot.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub model: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub usage_percent: f32,
    pub frequency_mhz: u64,
}

/// GPU snapshot — best-effort, awareness only.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub vendor: String,
}

/// A live snapshot of the machine's network + system state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub interfaces: Vec<InterfaceInfo>,
    /// First non-loopback IPv4 — the address the wallet most likely uses.
    pub default_local_ip: Option<String>,
    pub cpu: CpuInfo,
    pub gpu: Option<GpuInfo>,
}
