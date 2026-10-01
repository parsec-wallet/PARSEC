// PARSEC Wallet — the AgenticPlace agent directory (agenticplace.pythai.net).
//
// AgenticPlace keeps a database of registered agents (ERC-8004 identities across
// many chains) behind GET /api/agents?q=&page=&limit=. This module is the only
// door PARSEC opens to it, and it treats everything that comes back as
// untrusted data from outside:
//
//   * Bounded: 10 s timeout by default (a caller may allow up to 90 s), a response larger than 1 MB is refused, at most 50
//     results a page, a query of at most 100 characters.
//   * Checked: every record is rebuilt field by field — strings length-capped and
//     stripped of control and bidirectional-override characters (so a name cannot
//     render as someone else's), numbers clamped, addresses accepted only in
//     their exact format. Anything else is dropped, not passed along.
//   * Inert: image URLs are discarded (no third-party fetch with your IP), and no
//     field is ever markup, a link that opens itself, or an instruction. A result
//     cannot sign, pay or navigate; paying an agent goes through the x402 desk's
//     approval like any other payment.

export const DIRECTORY_URL = 'https://agenticplace.pythai.net';
const MAX_BYTES = 1_000_000;
const MAX_QUERY = 100;
const MAX_LIMIT = 50;

export interface DirectoryAgent {
  /** "<chainId>:<registry>:<tokenId>" as the directory states it. */
  id: string;
  chainId: number;
  tokenId: number;
  name: string;
  description: string;
  owner: string;
  verified: boolean;
  x402: boolean;
  stars: number;
  score: number;
  protocols: string[];
  createdAt: string;
}

export interface DirectoryPage {
  agents: DirectoryAgent[];
  page: number;
  pages: number;
  total: number;
  hasMore: boolean;
}

// C0/C1 controls, zero-width and bidi override/isolate characters.
const UNSAFE_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** A display-safe string: unsafe characters removed, whitespace collapsed, capped. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
  return [...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s;
}

function int(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : min;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AGENT_ID = /^\d{1,12}:0x[0-9a-fA-F]{40}:\d{1,20}$/;

/** Rebuild one record from untrusted JSON; null when it is not an agent record. */
export function sanitizeAgent(raw: unknown): DirectoryAgent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.agent_id === 'string' && AGENT_ID.test(r.agent_id) ? r.agent_id : '';
  const chainId = int(r.chain_id, 0, 2_147_483_647);
  if (!id || chainId === 0) return null;
  return {
    id,
    chainId,
    tokenId: int(r.token_id, 0, Number.MAX_SAFE_INTEGER),
    name: cleanText(r.name, 80) || 'Unnamed agent',
    description: cleanText(r.description, 600),
    owner: typeof r.owner_address === 'string' && EVM_ADDRESS.test(r.owner_address) ? r.owner_address : '',
    verified: r.is_verified === true,
    x402: r.x402_supported === true,
    stars: int(r.star_count, 0, 10_000_000),
    score: int(r.total_score, 0, 1_000_000),
    protocols: Array.isArray(r.supported_protocols)
      ? r.supported_protocols.slice(0, 8).map((p) => cleanText(p, 24)).filter(Boolean)
      : [],
    createdAt: /^\d{4}-\d{2}-\d{2}/.test(String(r.created_at ?? '')) ? String(r.created_at).slice(0, 10) : '',
  };
}

/** Parse a directory response body (already size-checked) into a page. */
export function parseDirectory(body: string): DirectoryPage {
  const d = JSON.parse(body) as { success?: unknown; data?: unknown; meta?: Record<string, unknown> };
  if (d.success !== true || !Array.isArray(d.data)) throw new Error('The directory answered with something that is not a list of agents.');
  const agents = d.data.slice(0, MAX_LIMIT).map(sanitizeAgent).filter((a): a is DirectoryAgent => a !== null);
  const m = d.meta ?? {};
  return {
    agents,
    page: int(m.page, 1, 1_000_000_000),
    pages: int(m.pages, 0, 1_000_000_000),
    total: int(m.total, 0, 1_000_000_000),
    hasMore: m.hasMore === true,
  };
}

/** Search the directory. An empty query lists agents. */
export async function searchDirectory(
  query: string,
  opts: { page?: number; limit?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DirectoryPage> {
  const q = cleanText(query, MAX_QUERY);
  const params = new URLSearchParams({
    page: String(Math.max(1, Math.floor(opts.page ?? 1))),
    limit: String(Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? 24)))),
  });
  if (q) params.set('q', q);
  const timeout = AbortSignal.timeout(Math.min(Math.max(opts.timeoutMs ?? 10_000, 1_000), 90_000));
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const res = await fetch(`${DIRECTORY_URL}/api/agents?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new Error(`The directory answered ${res.status}.`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error('The directory sent more than PARSEC accepts.');
  const body = await res.text();
  if (body.length > MAX_BYTES) throw new Error('The directory sent more than PARSEC accepts.');
  return parseDirectory(body);
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum', 10: 'Optimism', 56: 'BNB Chain', 100: 'Gnosis', 137: 'Polygon', 250: 'Fantom', 324: 'zkSync',
  1101: 'Polygon zkEVM', 5000: 'Mantle', 8453: 'Base', 42161: 'Arbitrum', 42220: 'Celo', 43114: 'Avalanche',
  59144: 'Linea', 81457: 'Blast', 534352: 'Scroll', 7777777: 'Zora', 11155111: 'Sepolia', 84532: 'Base Sepolia',
  130: 'Unichain', 146: 'Sonic', 252: 'Fraxtal', 480: 'World Chain', 1088: 'Metis', 1135: 'Lisk', 1868: 'Soneium',
  2741: 'Abstract', 34443: 'Mode', 57073: 'Ink', 80094: 'Berachain', 167000: 'Taiko', 11142220: 'Celo Sepolia',
};

export function chainName(id: number): string {
  return CHAIN_NAMES[id] ?? `Chain ${id}`;
}

const ownedCache = new Map<string, { at: number; agents: DirectoryAgent[] }>();

/**
 * Agents whose owner is exactly `evmAddress` (case-insensitive). The directory
 * has no owner filter, so this searches by the address and keeps exact owner
 * matches; on the live service that search is slow (tens of seconds), so the
 * result is remembered for the session (one hour).
 */
export async function agentsOwnedBy(evmAddress: string, opts: { signal?: AbortSignal } = {}): Promise<DirectoryAgent[]> {
  const key = evmAddress.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(key)) return [];
  const hit = ownedCache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.agents;
  const page = await searchDirectory(key, { limit: 50, timeoutMs: 60_000, signal: opts.signal });
  const agents = page.agents.filter((a) => a.owner.toLowerCase() === key);
  ownedCache.set(key, { at: Date.now(), agents });
  return agents;
}
