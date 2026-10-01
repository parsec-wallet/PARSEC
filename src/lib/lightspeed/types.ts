// PARSEC Wallet — Lightspeed provider seam
//
// A provider answers the few questions a light client answers — head block,
// chain id, an account balance, sync state, and a read-only contract call.
// Every method returns `null` for "not available here" so the local default
// can exist without a network and the feeds stay `unknown` rather than lying.
// A method that throws is reporting a failure, and the feeds say so.

import type { Reach } from '../ui/provenance';

export interface SyncStatus {
  readonly syncing: boolean;
  readonly current?: bigint;
  readonly highest?: bigint;
}

export interface LightspeedProvider {
  readonly id: string;
  readonly displayName: string;
  /** Stated in every provenance line — a host, or "this device". */
  readonly origin: string;
  readonly reach: Reach;

  blockNumber(): Promise<bigint | null>;
  chainId(): Promise<bigint | null>;
  /** Native balance in the chain's smallest unit (wei on EVM). */
  balanceOf(address: string): Promise<bigint | null>;
  syncStatus(): Promise<SyncStatus | null>;
  /** Read-only contract call — the `get$` half of light.js's makeContract. */
  call(to: string, data: string): Promise<string | null>;
}
