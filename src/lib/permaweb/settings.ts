// permaweb settings — Solana RPC endpoint + cluster, per device. Public RPCs are rate-limited hard
// enough that gateway-registry scans and observer submissions fail; the operator can point the module
// at a paid endpoint (Helius / Triton / QuickNode) without touching the rest of the wallet.

import { SOLANA_RPC } from '../solana/balance';

export type SolanaCluster = 'mainnet' | 'devnet';

export interface PermawebSettings {
  rpcUrl: string;
  /** Websocket URL for transaction confirmation; derived from rpcUrl when empty. */
  wsUrl: string;
  cluster: SolanaCluster;
}

const KEY = 'parsec-permaweb-settings';

export const DEFAULT_PERMAWEB_SETTINGS: PermawebSettings = { rpcUrl: SOLANA_RPC, wsUrl: '', cluster: 'mainnet' };

export function getPermawebSettings(): PermawebSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return { ...DEFAULT_PERMAWEB_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<PermawebSettings>;
    return {
      rpcUrl: typeof parsed.rpcUrl === 'string' && parsed.rpcUrl ? parsed.rpcUrl : SOLANA_RPC,
      wsUrl: typeof parsed.wsUrl === 'string' ? parsed.wsUrl : '',
      cluster: parsed.cluster === 'devnet' ? 'devnet' : 'mainnet',
    };
  } catch {
    return { ...DEFAULT_PERMAWEB_SETTINGS };
  }
}

export function setPermawebSettings(next: Partial<PermawebSettings>): PermawebSettings {
  const merged = { ...getPermawebSettings(), ...next };
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* storage unavailable */ }
  return merged;
}

/** ws(s) URL for the configured RPC — explicit wsUrl wins, else scheme swap. */
export function resolveWsUrl(s: PermawebSettings = getPermawebSettings()): string {
  if (s.wsUrl) return s.wsUrl;
  const u = new URL(s.rpcUrl);
  u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
  return u.toString().replace(/\/$/, '');
}
