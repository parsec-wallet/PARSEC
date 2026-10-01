// PARSEC Wallet — parsec_mesh IPC client
// P2P mesh where every client is a server.
// IPFS content-addressed handoffs. Resource-aware throttling.

import { invoke } from './platform';

// --- Types ---

export interface IpfsConfig {
  api_url: string;
  gateway_url: string;
  auto_pin: boolean;
  max_pin_bytes: number;
}

export interface LocalPeer {
  peer_id: string;
  public_key: string;
  listen_addresses: string[];
  ipfs_peer_id: string | null;
  capabilities: string[];
}

export interface ResourceMap {
  cpu_cores: number;
  cpu_usage_pct: number;
  ram_available: number;
  disk_available: number;
  bandwidth_up: number;
  bandwidth_down: number;
  power_draw_watts: number;
  electricity_cost_kwh: number;
}

export interface ResourceBudget {
  max_bandwidth_share: number;
  max_cpu_share_pct: number;
  max_storage_share: number;
  max_power_watts: number;
}

export interface ThrottleParams {
  cpu_throttle: number;
  bandwidth_throttle: number;
  power_throttle: number;
  combined_throttle: number;
  allowed_bandwidth_bps: number;
  allowed_cpu_pct: number;
}

export interface ResourceCost {
  duration_secs: number;
  avg_power_watts: number;
  cost_per_kwh: number;
  energy_kwh: number;
  cost_usd: number;
  bandwidth_bytes: number;
  bandwidth_cost_usd: number;
  total_cost_usd: number;
}

export interface PinnedContent {
  cid: string;
  pin_type: string;
}

// --- IPC ---

/** Initialize the mesh with local peer identity */
export async function meshInit(
  publicKey: string,
  listenPort: number,
  ipfsConfig?: IpfsConfig,
): Promise<LocalPeer> {
  return await invoke<LocalPeer>('mesh_init', {
    publicKey,
    listenPort,
    ipfsConfig: ipfsConfig ?? null,
  });
}

/** Start the embedded server (client becomes server) */
export async function meshStartServer(): Promise<string> {
  return await invoke<string>('mesh_start_server');
}

/** Get current resource snapshot */
export async function meshResources(): Promise<ResourceMap> {
  return await invoke<ResourceMap>('mesh_resources');
}

/** Get throttle parameters based on resources and budget */
export async function meshThrottle(): Promise<ThrottleParams> {
  return await invoke<ThrottleParams>('mesh_throttle');
}

/** Update the resource budget */
export async function meshSetBudget(budget: ResourceBudget): Promise<void> {
  await invoke('mesh_set_budget', { budget });
}

/** Compute resource cost for a work period */
export async function meshResourceCost(
  durationSecs: number,
  avgPowerWatts: number,
  costPerKwh: number,
  bandwidthBytes: number,
  bandwidthCostPerGb: number,
): Promise<ResourceCost> {
  return await invoke<ResourceCost>('mesh_resource_cost', {
    durationSecs,
    avgPowerWatts,
    costPerKwh,
    bandwidthBytes,
    bandwidthCostPerGb,
  });
}

/** Add content to IPFS */
export async function meshIpfsAdd(data: number[]): Promise<string> {
  return await invoke<string>('mesh_ipfs_add', { data });
}

/** Get content from IPFS by CID */
export async function meshIpfsGet(cid: string): Promise<number[]> {
  return await invoke<number[]>('mesh_ipfs_get', { cid });
}

/** Check if IPFS daemon is running */
export async function meshIpfsStatus(): Promise<boolean> {
  return await invoke<boolean>('mesh_ipfs_status');
}

/** List IPFS pins */
export async function meshIpfsPins(): Promise<PinnedContent[]> {
  return await invoke<PinnedContent[]>('mesh_ipfs_pins');
}
