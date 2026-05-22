//! Tauri IPC commands for network_monitor.
//!
//! All readings are computed fresh on each call — nothing is held or cached.
//! `network_info` is gated by `NetworkMonitorState.enabled`, which is off
//! until the participant explicitly turns monitoring on.

use std::fs;
use std::sync::atomic::Ordering;
use std::time::Duration;

use network_interface::{Addr, NetworkInterface, NetworkInterfaceConfig};
use sysinfo::System;
use tauri::State;

use super::{CpuInfo, GpuInfo, InterfaceInfo, NetworkInfo, NetworkMonitorState};

/// Turn the monitor on or off. Off by default; nothing reads the network or
/// system until this is set true.
#[tauri::command]
pub fn network_monitor_set_enabled(state: State<'_, NetworkMonitorState>, on: bool) {
    state.enabled.store(on, Ordering::SeqCst);
}

/// A fresh snapshot of network interfaces, CPU, and GPU. Errors while the
/// monitor is disabled — the command holds no state and stores nothing.
#[tauri::command]
pub async fn network_info(
    state: State<'_, NetworkMonitorState>,
) -> Result<NetworkInfo, String> {
    if !state.enabled.load(Ordering::SeqCst) {
        return Err("monitoring disabled".to_string());
    }

    // ── Interfaces ──────────────────────────────────────────────────────
    let raw = NetworkInterface::show().map_err(|e| e.to_string())?;
    let mut interfaces = Vec::with_capacity(raw.len());
    for itf in &raw {
        let mut ipv4 = Vec::new();
        let mut ipv6 = Vec::new();
        for addr in &itf.addr {
            match addr {
                Addr::V4(a) => ipv4.push(a.ip.to_string()),
                Addr::V6(a) => ipv6.push(a.ip.to_string()),
            }
        }
        interfaces.push(InterfaceInfo {
            name: itf.name.clone(),
            ipv4,
            ipv6,
            mac: itf.mac_addr.clone(),
            index: itf.index,
        });
    }
    let default_local_ip = interfaces
        .iter()
        .flat_map(|i| i.ipv4.iter())
        .find(|ip| !ip.starts_with("127."))
        .cloned();

    Ok(NetworkInfo {
        interfaces,
        default_local_ip,
        cpu: read_cpu().await,
        gpu: read_gpu(),
    })
}

/// MAC spoofing — set an interface's hardware address.
///
/// Requires OS privilege (root / admin); without it the underlying command
/// fails and the error is surfaced to the UI. Linux-only for now.
#[tauri::command]
pub fn network_set_mac(interface: String, mac: String) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let out = Command::new("ip")
            .args(["link", "set", "dev", &interface, "address", &mac])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(format!("MAC of {interface} set to {mac}"))
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (interface, mac);
        Err("MAC spoofing is currently wired for Linux only".to_string())
    }
}

/// Live CPU usage + identity. `num_cpus` (already a dependency) gives stable
/// core counts; `sysinfo` supplies the live usage percentage and model.
async fn read_cpu() -> CpuInfo {
    let mut sys = System::new();
    sys.refresh_cpu_all();
    // sysinfo needs two samples a moment apart for a meaningful usage %.
    tokio::time::sleep(Duration::from_millis(200)).await;
    sys.refresh_cpu_all();

    let usage_percent = sys.global_cpu_usage();
    let (model, frequency_mhz) = sys
        .cpus()
        .first()
        .map(|c| (c.brand().to_string(), c.frequency()))
        .unwrap_or_default();

    CpuInfo {
        model,
        physical_cores: num_cpus::get_physical(),
        logical_cores: num_cpus::get(),
        usage_percent,
        frequency_mhz,
    }
}

/// Best-effort GPU awareness. Reads Linux DRM sysfs for the driver + PCI
/// vendor; returns `None` where the GPU cannot be determined (macOS/Windows).
fn read_gpu() -> Option<GpuInfo> {
    for n in 0..6 {
        let base = format!("/sys/class/drm/card{n}/device");
        let Ok(vendor_id) = fs::read_to_string(format!("{base}/vendor")) else {
            continue;
        };
        let vendor = match vendor_id.trim().to_lowercase().as_str() {
            "0x10de" => "NVIDIA",
            "0x1002" => "AMD",
            "0x8086" => "Intel",
            _ => "Unknown",
        }
        .to_string();
        let name = fs::read_to_string(format!("{base}/uevent"))
            .ok()
            .and_then(|u| {
                u.lines()
                    .find_map(|l| l.strip_prefix("DRIVER=").map(str::to_string))
            })
            .unwrap_or_else(|| "GPU".to_string());
        return Some(GpuInfo { name, vendor });
    }
    None
}
