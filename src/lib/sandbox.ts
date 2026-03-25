// Parsec Wallet — parsec_sandbox IPC client
// dApp filesystem access control with 1-10 participant choice scale.
// The participant ALWAYS chooses. No silent escalation.

import { invoke } from '@tauri-apps/api/core';

// --- Types ---

export interface LevelCapabilities {
  level: number;
  description: string;
  can_read_sandbox: boolean;
  can_write_sandbox: boolean;
  max_write_bytes: number;
  can_read_shared: boolean;
  can_ipfs_get: boolean;
  can_ipfs_pin: boolean;
  can_read_user_files: boolean;
  can_write_user_files: boolean;
  can_peer_relay: boolean;
  can_search_index: boolean;
}

export interface DappPermission {
  dapp_id: string;
  dapp_name: string;
  dapp_origin: string;
  access_level: number;
  granted_by: string;
  granted_at: number;
  expires_at: number | null;
  storage_quota: number;
  storage_used: number;
  revoked: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  required_level: number;
  current_level: number;
  storage_remaining: number | null;
}

export interface AuditEntry {
  dapp_id: string;
  action: string;
  path: string | null;
  bytes: number | null;
  allowed: boolean;
  level_required: number;
  level_granted: number;
  timestamp: number;
}

// --- IPC ---

/** Initialize the sandbox engine */
export async function sandboxInit(appDataDir: string): Promise<void> {
  await invoke('sandbox_init', { appDataDir });
}

/** Get capabilities for a specific access level */
export async function sandboxLevelInfo(level: number): Promise<LevelCapabilities> {
  return await invoke<LevelCapabilities>('sandbox_level_info', { level });
}

/** Get capabilities for ALL levels (for the permission slider UI) */
export async function sandboxAllLevels(): Promise<LevelCapabilities[]> {
  return await invoke<LevelCapabilities[]>('sandbox_all_levels');
}

/** Grant filesystem access to a dApp at a user-chosen level */
export async function sandboxGrant(
  dappId: string,
  dappName: string,
  dappOrigin: string,
  accessLevel: number,
  grantedBy: string,
  expiresAt?: number,
): Promise<DappPermission> {
  return await invoke<DappPermission>('sandbox_grant', {
    dappId,
    dappName,
    dappOrigin,
    accessLevel,
    grantedBy,
    expiresAt: expiresAt ?? null,
  });
}

/** Revoke filesystem access for a dApp */
export async function sandboxRevoke(dappId: string): Promise<boolean> {
  return await invoke<boolean>('sandbox_revoke', { dappId });
}

/** Update the access level (participant slides the 1-10 scale) */
export async function sandboxUpdateLevel(dappId: string, newLevel: number): Promise<DappPermission> {
  return await invoke<DappPermission>('sandbox_update_level', { dappId, newLevel });
}

/** Check if a dApp can perform an action */
export async function sandboxCheck(
  dappId: string,
  action: string,
  path?: string,
  bytes?: number,
): Promise<AccessDecision> {
  return await invoke<AccessDecision>('sandbox_check', {
    dappId,
    action,
    path: path ?? null,
    bytes: bytes ?? null,
  });
}

/** Get current permission for a dApp */
export async function sandboxGetPermission(dappId: string): Promise<DappPermission | null> {
  return await invoke<DappPermission | null>('sandbox_get_permission', { dappId });
}

/** List all dApp permissions */
export async function sandboxListPermissions(): Promise<DappPermission[]> {
  return await invoke<DappPermission[]>('sandbox_list_permissions');
}

/** Get the audit log */
export async function sandboxAuditLog(limit?: number): Promise<AuditEntry[]> {
  return await invoke<AuditEntry[]>('sandbox_audit_log', { limit: limit ?? null });
}

/** Get the sandboxed path for a dApp */
export async function sandboxDappPath(dappId: string): Promise<string | null> {
  return await invoke<string | null>('sandbox_dapp_path', { dappId });
}
