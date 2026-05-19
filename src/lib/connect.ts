// Parsec Connect — IPC client for dApp WebSocket bridge
// Controls the connect server and handles sign request approval/rejection.
// (c) 2026 BANKON — GPL-3.0

import { invoke } from './platform';

// --- Types ---

export interface DappSession {
  session_id: string;
  origin: string;
  connected_at: number;
  account_address: string | null;
}

export interface SignRequest {
  request_id: number;
  session_id: string;
  origin: string;
  message: string;
  txn_count: number;
  txns_b64: string[];
  created_at: number;
}

// --- IPC ---

/** Start the connect server on localhost */
export async function connectStart(
  activeAddress: string,
  port?: number,
  allowedOrigins?: string[],
): Promise<string> {
  return await invoke<string>('connect_start', {
    port: port ?? 9876,
    allowedOrigins: allowedOrigins ?? ['https://agenticplace.pythai.net'],
    activeAddress,
  });
}

/** Stop the connect server */
export async function connectStop(): Promise<void> {
  await invoke('connect_stop');
}

/** List active dApp sessions */
export async function connectSessions(): Promise<DappSession[]> {
  return await invoke<DappSession[]>('connect_sessions');
}

/** Get pending sign requests awaiting user approval */
export async function connectPendingRequests(): Promise<SignRequest[]> {
  return await invoke<SignRequest[]>('connect_pending_requests');
}

/** Approve a sign request with signed transaction bytes */
export async function connectApproveSign(
  requestId: number,
  signedTxnsB64: string[],
): Promise<void> {
  await invoke('connect_approve_sign', { requestId, signedTxnsB64 });
}

/** Reject a sign request */
export async function connectRejectSign(
  requestId: number,
  reason?: string,
): Promise<void> {
  await invoke('connect_reject_sign', { requestId, reason });
}

/** Disconnect a specific dApp session */
export async function connectDisconnectSession(sessionId: string): Promise<void> {
  await invoke('connect_disconnect_session', { sessionId });
}
