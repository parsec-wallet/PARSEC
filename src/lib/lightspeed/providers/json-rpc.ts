// JSON-RPC provider — an EVM node the participant chose. Plain fetch, no
// provider library, the same shape as permaweb/bridge/base-rpc.ts. This is
// external reach: the endpoint learns which addresses you asked about.
//
// Desktop builds enforce a CSP `connect-src` allowlist (src-tauri/tauri.conf.json);
// an endpoint outside it fails at the network layer and shows as `deficient`.

import type { LightspeedProvider, SyncStatus } from '../types';

function hexToBigInt(hex: string): bigint {
  const h = hex.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(h)) throw new Error('invalid hex quantity');
  return h === '0x' ? 0n : BigInt(h);
}

function assertEvmAddress(address: string): string {
  const a = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error('invalid EVM address');
  return a;
}

export function jsonRpcProvider(url: string, fetchImpl: typeof fetch = fetch): LightspeedProvider {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('JSON-RPC endpoint must be http(s)');
  }

  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`${parsed.host} HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message?: string; code?: number } };
    if (json.error) throw new Error(json.error.message || `RPC error ${json.error.code ?? ''}`);
    if (json.result === undefined) throw new Error('RPC reply carried no result');
    return json.result;
  }

  return {
    id: 'json-rpc',
    displayName: `JSON-RPC · ${parsed.host}`,
    origin: parsed.host,
    reach: 'external',
    blockNumber: async () => hexToBigInt(await rpc<string>('eth_blockNumber', [])),
    chainId: async () => hexToBigInt(await rpc<string>('eth_chainId', [])),
    balanceOf: async (address) =>
      hexToBigInt(await rpc<string>('eth_getBalance', [assertEvmAddress(address), 'latest'])),
    syncStatus: async (): Promise<SyncStatus> => {
      const r = await rpc<false | { currentBlock?: string; highestBlock?: string }>('eth_syncing', []);
      if (r === false) return { syncing: false };
      return {
        syncing: true,
        current: r.currentBlock ? hexToBigInt(r.currentBlock) : undefined,
        highest: r.highestBlock ? hexToBigInt(r.highestBlock) : undefined,
      };
    },
    call: async (to, data) => rpc<string>('eth_call', [{ to: assertEvmAddress(to), data }, 'latest']),
  };
}
