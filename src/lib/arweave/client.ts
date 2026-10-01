// Arweave gateway client — thin wrapper around arweave-js that lets parsec
// swap gateways (arweave.net, ar-io.net, self-hosted) without leaking the
// dependency into every caller. The instance is memoised so repeated calls
// reuse the same HTTP connection pool.

import Arweave from 'arweave';

export interface ArweaveGatewayConfig {
  host: string;
  port?: number;
  protocol?: 'http' | 'https';
  timeout?: number;
}

const DEFAULT_GATEWAY: ArweaveGatewayConfig = {
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
  timeout: 20_000,
};

let _client: Arweave | null = null;
let _config: ArweaveGatewayConfig = DEFAULT_GATEWAY;

/** Get the shared Arweave client, lazily constructed from the active gateway. */
export function getArweaveClient(): Arweave {
  if (!_client) {
    _client = Arweave.init(_config);
  }
  return _client;
}

/** Override the active gateway. Forces the next getArweaveClient() to rebuild. */
export function setArweaveGateway(config: Partial<ArweaveGatewayConfig>): void {
  _config = { ...DEFAULT_GATEWAY, ..._config, ...config };
  _client = null;
}

/** Reset to defaults (used by tests + when the user resets settings). */
export function resetArweaveClient(): void {
  _config = DEFAULT_GATEWAY;
  _client = null;
}

// ── High-level convenience wrappers ────────────────────────────

/** Winston-AR cost to store `bytes` of data, optionally with a target recipient. */
export async function getStorageCost(bytes: number, target?: string): Promise<bigint> {
  const arweave = getArweaveClient();
  const winston = await arweave.transactions.getPrice(bytes, target);
  return BigInt(winston);
}

/** Fresh anchor for transaction last_tx. Stale anchors get the tx rejected. */
export async function getAnchor(): Promise<string> {
  const arweave = getArweaveClient();
  return await arweave.transactions.getTransactionAnchor();
}

/** Confirmation status for a posted transaction. */
export interface TxStatus {
  status: number;             // HTTP status — 200 confirmed, 202 pending, 404 unknown
  confirmed: {
    block_height: number;
    block_indep_hash: string;
    number_of_confirmations: number;
  } | null;
}

export async function getTxStatus(txId: string): Promise<TxStatus> {
  const arweave = getArweaveClient();
  return await arweave.transactions.getStatus(txId);
}

/** Raw data for a confirmed transaction. */
export async function getData(
  txId: string,
  opts: { decode?: boolean; string?: boolean } = {},
): Promise<Uint8Array | string> {
  const arweave = getArweaveClient();
  return await arweave.transactions.getData(txId, {
    decode: opts.decode ?? true,
    string: opts.string ?? false,
  });
}

/** Convert winston (smallest unit, 1e-12 AR) ↔ AR. */
export function winstonToAr(winston: bigint | string | number): string {
  const arweave = getArweaveClient();
  return arweave.ar.winstonToAr(typeof winston === 'bigint' ? winston.toString() : String(winston));
}

export function arToWinston(ar: string): string {
  const arweave = getArweaveClient();
  return arweave.ar.arToWinston(ar);
}

/** Balance of an Arweave address, returned in AR (not winston). */
export async function getArBalance(address: string): Promise<string> {
  const arweave = getArweaveClient();
  const winston = await arweave.wallets.getBalance(address);
  return arweave.ar.winstonToAr(winston);
}
