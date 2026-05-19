// Dashboard module registry — cypherpunk2048 principle #4. Each chain
// pack (Algorand / Arweave / Solana / …) and each domain pack (BANKON
// Names / AR.IO Names / Marketspace / Migration) registers a row factory
// here. `dashboard.ts` iterates over the registered modules and renders
// the union, with no hard-coded chain assumptions.
//
// The intent is that adding a new chain or new dApp surface is one new
// module registration — no edits to the dashboard view itself.

import type { WalletAccount } from '../types/wallet';

/**
 * Context passed to every dashboard module's `render` call. Contains the
 * active account, the per-chain address lookup helper, the active network
 * setting, and a `navigate(view)` callback the module's buttons can use.
 */
export interface DashboardContext {
  account: WalletAccount;
  /** Resolved address for a chain id; undefined if the account doesn't have one. */
  getChainAddress(chainId: string): string | undefined;
  network: 'mainnet' | 'testnet' | 'betanet';
  navigate(view: string): void;
  /** Called when the user clicks the "refresh" affordance on a tile.
   *  Modules can implement their own refresh handler. */
  refresh(): void;
}

/**
 * A dashboard module returns the row element to render — or null if the
 * module decides it isn't relevant for the current account state (e.g.
 * "no Arweave address on this account → don't show the AR.IO row").
 */
export interface DashboardModule {
  /** Stable id for the module. Used for ordering + deduplication. */
  readonly id: string;
  /** Sort priority. Lower numbers render first. */
  readonly priority: number;
  /** Whether this module is enabled in the current build. */
  readonly enabled: boolean;
  /** Build the row for this module. Returning null hides it. */
  render(ctx: DashboardContext): HTMLElement | null;
}

const REGISTRY: Map<string, DashboardModule> = new Map();

export function registerDashboardModule(mod: DashboardModule): void {
  REGISTRY.set(mod.id, mod);
}

/** Modules in render order — sorted by priority asc, then registration order. */
export function listDashboardModules(): DashboardModule[] {
  return Array.from(REGISTRY.values())
    .filter((m) => m.enabled)
    .sort((a, b) => a.priority - b.priority);
}
