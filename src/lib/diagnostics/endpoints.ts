// Reachability probes for the services PARSEC depends on — IPFS, Arweave,
// Algorand/.algo (NFD), Solana. Each probe is a fresh timed fetch; results
// are returned to the caller and never stored.

import type { EndpointStatus } from './types';

interface EndpointDef {
  label: string;
  group: string;
  url: string;
}

/** The endpoints the wallet actually talks to. */
export const ENDPOINTS: EndpointDef[] = [
  { group: 'Algorand', label: 'algod (mainnet)', url: 'https://mainnet-api.4160.nodely.dev/health' },
  { group: 'Algorand', label: 'indexer (mainnet)', url: 'https://mainnet-idx.4160.nodely.dev/health' },
  { group: '.algo / NFD', label: 'NFD registry API', url: 'https://api.nf.domains/info' },
  { group: 'IPFS', label: 'IPFS gateway', url: 'https://ipfs.io' },
  { group: 'Arweave', label: 'Arweave gateway', url: 'https://arweave.net/info' },
  { group: 'Arweave', label: 'AO compute unit', url: 'https://cu.ardrive.io' },
  { group: 'Solana', label: 'Solana RPC', url: 'https://solana-rpc.publicnode.com' },
];

const TIMEOUT_MS = 4000;
const SLOW_MS = 1200;

/**
 * Probe one endpoint. `no-cors` keeps it a pure reachability + timing check
 * (an opaque resolution means reachable); `no-store` guarantees nothing is
 * cached. Returns a status — the caller displays it and discards it.
 */
export async function probeEndpoint(def: EndpointDef): Promise<EndpointStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    await fetch(def.url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    const latencyMs = Math.round(performance.now() - started);
    return {
      label: def.label,
      group: def.group,
      url: def.url,
      state: latencyMs > SLOW_MS ? 'slow' : 'ok',
      latencyMs,
    };
  } catch {
    return { label: def.label, group: def.group, url: def.url, state: 'down', latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}
