// Solana JSON-RPC client — minimal read + submit surface for the wallet's
// Solana dashboard panel and send flow. Same privacy caveat as the CoinGecko
// price feed (a public endpoint sees the queried address). Solana has no
// testnet/betanet tie to Algorand's network setting, so the wallet treats
// Solana as always-mainnet.
//
// NOT api.mainnet-beta.solana.com — that endpoint returns HTTP 403 for any
// request carrying an Origin header (i.e. every browser request). PublicNode
// is a keyless, CORS-enabled public RPC that serves frontend requests.

export const SOLANA_RPC = 'https://solana-rpc.publicnode.com';
export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Low-level JSON-RPC call. Throws on HTTP or RPC-level error. */
export async function solanaRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message || 'Solana RPC error');
  return json.result as T;
}

/** Balance of a Solana address, in SOL. */
export async function fetchSolBalance(address: string): Promise<number> {
  const result = await solanaRpc<{ value: number }>('getBalance', [address]);
  return (result?.value ?? 0) / LAMPORTS_PER_SOL;
}
