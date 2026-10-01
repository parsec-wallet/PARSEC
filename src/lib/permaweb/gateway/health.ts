// Gateway node health — the `/ar-io/info` probe every operator runs before and after joining.

import { ARIO_PROGRAMS, MIN_NODE_RELEASE } from '../constants';

export interface NodeInfo {
  release?: number | string;
  wallet?: string;
  programIds?: { core?: string; gar?: string; arns?: string; ant?: string };
  processId?: string;
  [k: string]: unknown;
}

export interface NodeProbe {
  ok: boolean;
  url: string;
  info?: NodeInfo;
  release?: number;
  error?: string;
  latencyMs?: number;
}

export function nodeInfoUrl(fqdn: string, port = 443, protocol: 'https' | 'http' = 'https'): string {
  const host = fqdn.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const p = (protocol === 'https' && port === 443) || (protocol === 'http' && port === 80) ? '' : `:${port}`;
  return `${protocol}://${host}${p}/ar-io/info`;
}

export async function probeNodeInfo(fqdn: string, port = 443, timeoutMs = 10_000): Promise<NodeProbe> {
  const url = nodeInfoUrl(fqdn, port);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!res.ok) return { ok: false, url, error: `HTTP ${res.status}` };
    const info = (await res.json()) as NodeInfo;
    const release = Number(info.release ?? 0) || undefined;
    return { ok: true, url, info, release, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, url, error: e instanceof Error ? e.message : String(e) };
  }
}

export function nodeReleaseOk(p: NodeProbe): boolean {
  return p.ok && (p.release ?? 0) >= MIN_NODE_RELEASE;
}

export function nodeWalletMatches(p: NodeProbe, operator: string): boolean {
  return p.ok && typeof p.info?.wallet === 'string' && p.info.wallet === operator;
}

/** Every program id the node reports must match mainnet (a mismatch is the usual "inert gateway" cause). */
export function nodeProgramsMatch(p: NodeProbe): { ok: boolean; mismatched: string[] } {
  const ids = p.info?.programIds;
  if (!ids) return { ok: false, mismatched: ['programIds missing (pre-Solana release?)'] };
  const mismatched = (['core', 'gar', 'arns', 'ant'] as const).filter((k) => ids[k] && ids[k] !== ARIO_PROGRAMS[k]).map((k) => k);
  return { ok: mismatched.length === 0, mismatched };
}
