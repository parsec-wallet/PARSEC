// AO process transport — PARSEC-owned subset of @permaweb/aoconnect.
//
// AO architecture (https://cookbook_ao.arweave.dev):
//   * MU (Messaging Unit) — accepts signed ANS-104 DataItems, schedules them
//   * SU (Scheduler Unit) — orders messages for a given process
//   * CU (Compute Unit)  — runs the WASM, exposes /dry-run and /result
//
// We talk to these directly via fetch, consuming SignedDataItem from ans104.ts.

import type { SignedDataItem, DataItemTag } from './ans104';

export interface AoEndpoints {
  /** Messaging Unit base URL. */
  mu: string;
  /** Compute Unit base URL. */
  cu: string;
  /** Gateway base URL (for tag lookups, balances, etc.). */
  gateway: string;
}

// AO mainnet MU is still called "ao-testnet" in DNS (legacy soft-launch
// naming). AR.IO's CU is cu.ardrive.io — use it whenever the process is
// the AR.IO network process or any ANT. See setAoEndpointsForArio() below.
const MAINNET: AoEndpoints = {
  mu: 'https://mu.ao-testnet.xyz',
  cu: 'https://cu.ardrive.io',
  gateway: 'https://arweave.net',
};

let _endpoints: AoEndpoints = MAINNET;

/**
 * Canonical AOS module — the WASM interpreter a spawned process runs on.
 * `Module` on a Spawn DataItem MUST be the TxID of a real uploaded module;
 * this is the long-standing AOS 2.x module (sqlite + Handlers). A process
 * loads its own Lua via the `On-Boot` tag — see buildAoSpawnInput({ onBoot }).
 */
export const AOS_MODULE = 'Do_Uc2Sju_ffp6Ev0AnLVdPtot15rvMjP-a9VVaA5fM';

export function setAoEndpoints(endpoints: Partial<AoEndpoints>): void {
  _endpoints = { ..._endpoints, ...endpoints };
}

export function getAoEndpoints(): AoEndpoints {
  return _endpoints;
}

// ── Message (write) ──────────────────────────────────────────

export interface AoMessageResult {
  /** DataItem id assigned by the MU. */
  id: string;
}

/**
 * POST a signed DataItem to the MU. The DataItem must carry a
 * `Type: Message` tag and a `Variant: ao.TN.1` tag plus the target process
 * id as the DataItem `target` (callers using buildAoMessageInput get this).
 */
export async function aoMessage(item: SignedDataItem): Promise<AoMessageResult> {
  const res = await fetch(_endpoints.mu, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: item.raw as unknown as BodyInit,
  });
  if (!res.ok) {
    throw new Error(`AO MU rejected message: ${res.status} ${await safeBody(res)}`);
  }
  // The MU echoes the id on success.
  return { id: item.id };
}

// ── Result (read) ────────────────────────────────────────────

export interface AoMessageOutput {
  Output?: unknown;
  Messages?: unknown[];
  Spawns?: unknown[];
  Error?: string;
}

/**
 * Poll the CU for the result of a message. The CU computes the new process
 * state lazily, so the first call after a fresh message may take a few
 * seconds while it catches up.
 */
export async function aoResult(opts: {
  message: string;
  process: string;
}): Promise<AoMessageOutput> {
  const url = `${_endpoints.cu}/result/${opts.message}?process-id=${encodeURIComponent(opts.process)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`AO CU rejected result query: ${res.status} ${await safeBody(res)}`);
  }
  return (await res.json()) as AoMessageOutput;
}

// ── Dry-run (read-only query) ────────────────────────────────

/**
 * Read-only AO call. The CU evaluates the message against the current
 * process state without scheduling, so no DataItem signing is needed.
 */
export async function aoDryRun(opts: {
  process: string;
  data?: string | Uint8Array;
  tags?: DataItemTag[];
  anchor?: string;
}): Promise<AoMessageOutput> {
  const body = {
    Id: '0000000000000000000000000000000000000000000',
    Owner: '0000000000000000000000000000000000000000000',
    Target: opts.process,
    Anchor: opts.anchor ?? '0',
    Data: opts.data == null ? '' : (typeof opts.data === 'string' ? opts.data : new TextDecoder().decode(opts.data)),
    Tags: opts.tags ?? [],
  };
  const res = await fetch(`${_endpoints.cu}/dry-run?process-id=${encodeURIComponent(opts.process)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`AO CU rejected dry-run: ${res.status} ${await safeBody(res)}`);
  }
  return (await res.json()) as AoMessageOutput;
}

// ── Spawn (create process) ───────────────────────────────────

/**
 * Spawn a new AO process. The DataItem must target the AO scheduler with
 * tags Module + Scheduler + Type=Process. Build via buildAoSpawnInput().
 */
export async function aoSpawn(item: SignedDataItem): Promise<{ id: string }> {
  // Same MU endpoint as messaging — Type tag tells the network it's a spawn.
  return await aoMessage(item);
}

// ── Helpers for building DataItem inputs ─────────────────────

export function buildAoMessageInput(opts: {
  process: string;
  data?: string | Uint8Array;
  tags?: DataItemTag[];
  anchor?: string;
}): { target: string; anchor?: string; tags: DataItemTag[]; data: Uint8Array | string } {
  const baseTags: DataItemTag[] = [
    { name: 'Data-Protocol', value: 'ao' },
    { name: 'Variant', value: 'ao.TN.1' },
    { name: 'Type', value: 'Message' },
    { name: 'SDK', value: 'parsec-wallet' },
  ];
  return {
    target: opts.process,
    anchor: opts.anchor,
    tags: [...baseTags, ...(opts.tags ?? [])],
    data: opts.data ?? '',
  };
}

export function buildAoSpawnInput(opts: {
  /** Module TxID — a real uploaded AOS module (see AOS_MODULE). */
  module: string;
  scheduler: string;
  data?: string | Uint8Array;
  tags?: DataItemTag[];
  anchor?: string;
  /** When true, add `On-Boot: Data` so AOS evaluates the DataItem's Data
   *  (the process's own bundled Lua source) on boot. */
  onBoot?: boolean;
}): { target: string; anchor?: string; tags: DataItemTag[]; data: Uint8Array | string } {
  const baseTags: DataItemTag[] = [
    { name: 'Data-Protocol', value: 'ao' },
    { name: 'Variant', value: 'ao.TN.1' },
    { name: 'Type', value: 'Process' },
    { name: 'Module', value: opts.module },
    { name: 'Scheduler', value: opts.scheduler },
    { name: 'SDK', value: 'parsec-wallet' },
  ];
  if (opts.onBoot) baseTags.push({ name: 'On-Boot', value: 'Data' });
  return {
    // Spawn targets the scheduler.
    target: opts.scheduler,
    anchor: opts.anchor,
    tags: [...baseTags, ...(opts.tags ?? [])],
    data: opts.data ?? '',
  };
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}
