// PARSEC Wallet — the PARSEC Keycore's own approval, from the app's side.
//
// Every signature on the desktop is approved in a native dialog the Keycore shows, not in
// the webview. Without a token, each signing command asks by itself. For a batch — a
// transaction group, an upload of many items — `keycoreApprove` asks once and returns a
// single-use token covering exactly those payloads (by SHA-256), for two minutes; pass it
// to each signing call. The x402 auto-approve cap is a Keycore allowance, granted in a
// native dialog and enforced by Rust on the decoded payment amount.
//
// The browser build has no Keycore; these are desktop-only (`isTauri`).

import { invoke } from './platform';

export interface ApproveRequest {
  address: string;
  chain: 'algorand' | 'solana' | 'arweave';
  /** Short title for the dialog, e.g. "send 3 transactions". */
  title: string;
  /** The app's own description — shown under "the app says (not verified)". */
  claims?: string[];
  /** Exactly the bytes each signing call will be given. */
  payloads: Uint8Array[];
}

/** One native dialog for a batch. Rejects if the person cancels. */
export async function keycoreApprove(req: ApproveRequest): Promise<string> {
  const r = await invoke<{ approval: string }>('keycore_approve', {
    args: {
      address: req.address,
      chain: req.chain,
      title: req.title,
      claims: req.claims ?? [],
      payloads_b64: req.payloads.map(toB64),
    },
  });
  return r.approval;
}

export interface AllowanceRequest {
  address: string;
  genesisId: string;
  assetId: number;
  /** Base units. */
  perPayment: bigint;
  total: bigint;
  minutes: number;
  claims?: string[];
}

/** Grant a session allowance for Algorand asset payments without a dialog each time. */
export async function keycoreAllowanceGrant(req: AllowanceRequest): Promise<void> {
  await invoke('keycore_allowance_grant', {
    args: {
      address: req.address,
      genesis_id: req.genesisId,
      asset_id: req.assetId,
      per_payment: Number(req.perPayment),
      total: Number(req.total),
      minutes: req.minutes,
      claims: req.claims ?? [],
    },
  });
}

export async function keycoreAllowanceRevoke(): Promise<void> {
  await invoke('keycore_allowance_revoke');
}

export interface AllowanceStatus {
  active: boolean;
  address?: string;
  genesis_id?: string;
  asset_id?: number;
  per_payment?: number;
  remaining?: number;
  expires_in_s?: number;
}

export async function keycoreAllowanceStatus(): Promise<AllowanceStatus> {
  return await invoke<AllowanceStatus>('keycore_allowance_status');
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
