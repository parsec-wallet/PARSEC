// Base (8453) JSON-RPC — the minimal read/submit surface the bridge needs. Plain fetch, no provider
// library. Used both by the vault-signed path (nonce, fees, gas, broadcast) and for balance reads
// regardless of which wallet signs.

import { BASE_RPC, BASE_ARIO, BRIDGE_CONFIRMATIONS } from '../constants';
import { encodeBalanceOf, decodeUint256 } from './abi';

let rpcUrl = BASE_RPC;
export function setBaseRpcUrl(url: string): void { rpcUrl = url; }

export async function baseRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Base RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string; code?: number } };
  if (json.error) throw new Error(json.error.message || `Base RPC error ${json.error.code ?? ''}`);
  return json.result as T;
}

/** Raw (6-decimal) ARIO balance of `holder` on Base. */
export async function readBaseArioBalance(holder: string): Promise<bigint> {
  const hex = await baseRpc<string>('eth_call', [{ to: BASE_ARIO, data: encodeBalanceOf(holder) }, 'latest']);
  return decodeUint256(hex);
}

export async function readEthBalance(address: string): Promise<bigint> {
  return decodeUint256(await baseRpc<string>('eth_getBalance', [address, 'latest']));
}

export async function getNonce(address: string): Promise<number> {
  return Number(decodeUint256(await baseRpc<string>('eth_getTransactionCount', [address, 'pending'])));
}

export interface FeeHints { maxPriorityFeePerGas: bigint; maxFeePerGas: bigint; baseFeePerGas: bigint }

/** EIP-1559 fee hints: priority from the node, max = 2 × base + priority (absorbs a few blocks of drift). */
export async function getFeeHints(): Promise<FeeHints> {
  const [prioHex, block] = await Promise.all([
    baseRpc<string>('eth_maxPriorityFeePerGas', []).catch(() => '0x3b9aca00'), // 1 gwei fallback
    baseRpc<{ baseFeePerGas?: string }>('eth_getBlockByNumber', ['latest', false]),
  ]);
  const maxPriorityFeePerGas = decodeUint256(prioHex);
  const baseFeePerGas = decodeUint256(block?.baseFeePerGas ?? '0x0');
  return { maxPriorityFeePerGas, baseFeePerGas, maxFeePerGas: baseFeePerGas * 2n + maxPriorityFeePerGas };
}

export async function estimateGas(tx: { from: string; to: string; data: string; value?: string }): Promise<bigint> {
  const est = decodeUint256(await baseRpc<string>('eth_estimateGas', [{ ...tx, value: tx.value ?? '0x0' }]));
  return (est * 120n) / 100n; // 20 % headroom
}

export async function sendRaw(rawHex: string): Promise<string> {
  return baseRpc<string>('eth_sendRawTransaction', [rawHex]);
}

export interface Receipt { status: '0x0' | '0x1'; blockNumber: string; transactionHash: string }

/** Poll until the receipt exists and has `confirmations` blocks on top of it. */
export async function waitForReceipt(
  hash: string,
  confirmations: number = BRIDGE_CONFIRMATIONS,
  opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (confs: number) => void } = {},
): Promise<Receipt> {
  const interval = opts.intervalMs ?? 3000;
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  for (;;) {
    const r = await baseRpc<Receipt | null>('eth_getTransactionReceipt', [hash]);
    if (r) {
      if (r.status === '0x0') throw new Error(`transaction ${hash} reverted`);
      const head = Number(decodeUint256(await baseRpc<string>('eth_blockNumber', [])));
      const confs = head - Number(decodeUint256(r.blockNumber)) + 1;
      opts.onProgress?.(confs);
      if (confs >= confirmations) return r;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${hash}`);
    await new Promise((res) => setTimeout(res, interval));
  }
}
