// PARSEC Connect — IPC client for dApp WebSocket bridge
// Controls the connect server and handles sign request approval/rejection.
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

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

/**
 * Origins allowed to reach the Connect server by default — the PYTHAI suite.
 *
 * This gates the HTTP endpoints (`/health`, `/info`) that a page uses to detect PARSEC.
 * Localhost is always added by the Rust side for development. Keep in step with the
 * default in src-tauri/src/parsec_connect/commands.rs.
 */
export const DEFAULT_CONNECT_ORIGINS = [
  'https://bankon.pythai.net',
  'https://agenticplace.pythai.net',
  'https://mindx.pythai.net',
  'https://deltaverse.pythai.net',
  'https://rage.pythai.net',
  'https://pythai.net',
];

/** Start the connect server on localhost */
export async function connectStart(
  activeAddress: string,
  port?: number,
  allowedOrigins?: string[],
): Promise<string> {
  return await invoke<string>('connect_start', {
    port: port ?? 9876,
    allowedOrigins: allowedOrigins ?? DEFAULT_CONNECT_ORIGINS,
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

// ── Name requests (parsec_nameRequest) ────────────────────────────────────────
// A web page states an intent against a name it controls; PARSEC renders it, the user
// approves, and the wallet builds and signs. See src/lib/names/intent.ts for the ops.

export interface NameRequest {
  requestId: number;
  sessionId: string;
  origin: string;
  /** Namespace adapter id — 'solana-arns' | 'arns' | 'bankon' */
  namespace: string;
  /** One of NAME_OPS; the Rust side rejects anything else before it reaches the UI. */
  op: string;
  name: string;
  params: Record<string, unknown>;
  createdAt: number;
}

export async function connectPendingNameRequests(): Promise<NameRequest[]> {
  return invoke<NameRequest[]>('connect_pending_name_requests');
}

/** Hand the adapter's result back to the waiting page. */
export async function connectApproveName(
  requestId: number,
  result: unknown,
): Promise<void> {
  await invoke('connect_approve_name', { requestId, result });
}

export async function connectRejectName(
  requestId: number,
  reason?: string,
): Promise<void> {
  await invoke('connect_reject_name', { requestId, reason });
}
