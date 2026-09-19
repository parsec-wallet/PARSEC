// Parsec Wallet — chainmarketcap: the EVM chain reference, as an optional extension.
//
// OFF BY DEFAULT, deliberately. Parsec works fully without it; switching it on
// is a decision to reach a service that is not required for the wallet to
// function, and defaults that quietly add network reach are how sovereign tools
// stop being sovereign.
//
// SOURCE. deltaverse.pythai.net/chainmarketcap.html is a 192 kB page that itself
// loads `chainid.network/chains.json`. Consuming the structured registry rather
// than scraping the page is both more honest and less brittle — a page redesign
// should not break the wallet. The source is configurable because delivery from
// deltaverse is under our control, so a first-party JSON endpoint can replace
// this without touching consumers.

/** Where the EVM chain registry is read from. */
export const CHAIN_REGISTRY_URL = 'https://chainid.network/chains.json';

/** The human-facing reference this data backs. */
export const CHAINMARKETCAP_URL = 'https://deltaverse.pythai.net/chainmarketcap.html';

export interface EvmChain {
  chainId: number;
  name: string;
  shortName: string;
  /** Native currency ticker, e.g. ETH. */
  symbol: string;
  decimals: number;
  /** Public RPCs, https only — see `sanitizeRpcs`. */
  rpc: string[];
  explorer?: string;
}

/**
 * Keep only RPC endpoints safe to offer.
 *
 * Drops anything that is not https and anything carrying an `${...}` template
 * placeholder — the registry includes entries needing an API key, and showing a
 * participant a URL with `${INFURA_API_KEY}` in it is worse than showing none.
 * Also drops websocket endpoints, which this reference does not use.
 */
export function sanitizeRpcs(rpcs: unknown): string[] {
  if (!Array.isArray(rpcs)) return [];
  return rpcs
    .filter((r): r is string => typeof r === 'string')
    .filter((r) => r.startsWith('https://'))
    .filter((r) => !r.includes('${'))
    .slice(0, 4);
}

/** Parse one registry entry, or null if it is not usable. */
export function parseChain(raw: unknown): EvmChain | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const chainId = Number(o.chainId);
  const name = typeof o.name === 'string' ? o.name : '';
  if (!Number.isFinite(chainId) || chainId <= 0 || !name) return null;

  const native = (o.nativeCurrency ?? {}) as Record<string, unknown>;
  const explorers = Array.isArray(o.explorers) ? o.explorers : [];
  const firstExplorer = explorers
    .map((e) => (typeof e === 'object' && e !== null ? (e as Record<string, unknown>).url : null))
    .find((u): u is string => typeof u === 'string' && u.startsWith('https://'));

  return {
    chainId,
    name,
    shortName: typeof o.shortName === 'string' ? o.shortName : name,
    symbol: typeof native.symbol === 'string' ? native.symbol : '',
    decimals: Number.isFinite(Number(native.decimals)) ? Number(native.decimals) : 18,
    rpc: sanitizeRpcs(o.rpc),
    explorer: firstExplorer,
  };
}

/** Parse the whole registry, discarding unusable entries rather than failing. */
export function parseRegistry(raw: unknown): EvmChain[] {
  if (!Array.isArray(raw)) return [];
  const out: EvmChain[] = [];
  for (const entry of raw) {
    const chain = parseChain(entry);
    if (chain) out.push(chain);
  }
  return out;
}

/** Search by name, short name, symbol or chain id. */
export function searchChains(chains: ReadonlyArray<EvmChain>, query: string): EvmChain[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...chains];
  return chains.filter((c) =>
    c.name.toLowerCase().includes(q)
    || c.shortName.toLowerCase().includes(q)
    || c.symbol.toLowerCase().includes(q)
    || String(c.chainId) === q);
}

// ── Fetching ────────────────────────────────────────────────────────────────

const CACHE_TTL = 6 * 60 * 60 * 1000; // the chain registry changes slowly
let cache: { at: number; chains: EvmChain[] } | null = null;

/**
 * Load the registry. Only ever called when the extension is switched on — the
 * caller is responsible for that, so this function is never a hidden request.
 */
export async function fetchChains(url = CHAIN_REGISTRY_URL): Promise<EvmChain[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.chains;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`chain registry returned HTTP ${res.status}`);
  const chains = parseRegistry(await res.json());
  cache = { at: Date.now(), chains };
  return chains;
}

/** Drop the cached registry. Tests, and an explicit participant refresh. */
export function __resetCache(): void {
  cache = null;
}
