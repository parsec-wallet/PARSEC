// Client for ar.io's bridge service (https://bridge.services.ar.io) — the off-chain half of the
// Base → Solana ARIO bridge. It watches `Burn(from, amount, destination)` on the Base token and sends
// SPL ARIO to `destination`. Surface reverse-engineered from swap.ar.io on 2026-08-28 (`/v1/info`,
// `/v1/status/{txHash}`, `/v1/transfers`, `/v1/resolve-ens`); fields not in `/v1/info` are optional.

import { BRIDGE_SERVICE } from '../constants';

export interface BridgeInfo {
  direction: string;                       // "base->solana"
  base: { chainId: number; arioAddress: string; decimals: number; confirmations: number };
  solana: { mint: string; decimals: number };
  destinationFormat: string;               // "solana:<recipient-base58>"
  minAmountRaw: string;
  feePercentage: number;
  bridgePaysRecipientAccountRent: boolean;
}

export interface BridgeTransfer {
  status?: string;
  inputTxId?: string;
  outputTxId?: string;
  outputAmountRaw?: string;
  inputAmountRaw?: string;
  recipientWallet?: string;
  senderWallet?: string;
  feeChargedRaw?: string;
  error?: string;
  [k: string]: unknown;
}

let baseUrl = BRIDGE_SERVICE;
export function setBridgeServiceUrl(url: string): void { baseUrl = url.replace(/\/$/, ''); }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`bridge service ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const getBridgeInfo = (): Promise<BridgeInfo> => get<BridgeInfo>('/v1/info');
export const getTransferStatus = (txHash: string): Promise<BridgeTransfer> => get<BridgeTransfer>(`/v1/status/${encodeURIComponent(txHash)}`);
export const listTransfers = (): Promise<BridgeTransfer[]> => get<BridgeTransfer[] | { transfers?: BridgeTransfer[] }>('/v1/transfers')
  .then((r) => (Array.isArray(r) ? r : (r.transfers ?? [])));

const TERMINAL = /^(completed|complete|success|succeeded|done|failed|error|rejected)$/i;

/** Poll `/v1/status/{txHash}` until a terminal status (or an outputTxId) appears. */
export async function pollTransfer(
  txHash: string,
  onUpdate: (t: BridgeTransfer) => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<BridgeTransfer> {
  const interval = opts.intervalMs ?? 5000;
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60_000);
  let last: BridgeTransfer = {};
  for (;;) {
    try {
      last = await getTransferStatus(txHash);
      onUpdate(last);
      if (last.outputTxId || (last.status && TERMINAL.test(last.status))) return last;
    } catch (e) {
      onUpdate({ ...last, error: e instanceof Error ? e.message : String(e) });
    }
    if (Date.now() > deadline) return { ...last, error: 'timed out waiting for the bridge service' };
    await new Promise((res) => setTimeout(res, interval));
  }
}
