// Shared types for the Diagnostics screen. These mirror the Rust
// network_monitor snapshot — no data is stored, only typed in transit.

export interface InterfaceInfo {
  name: string;
  ipv4: string[];
  ipv6: string[];
  mac: string | null;
  index: number;
}

export interface CpuInfo {
  model: string;
  physicalCores: number;
  logicalCores: number;
  usagePercent: number;
  frequencyMhz: number;
}

export interface GpuInfo {
  name: string;
  vendor: string;
}

export interface NetworkInfo {
  interfaces: InterfaceInfo[];
  defaultLocalIp: string | null;
  cpu: CpuInfo;
  gpu: GpuInfo | null;
}

export type EndpointState = 'ok' | 'slow' | 'down' | 'checking';

export interface EndpointStatus {
  label: string;
  group: string;
  url: string;
  state: EndpointState;
  latencyMs: number | null;
}
