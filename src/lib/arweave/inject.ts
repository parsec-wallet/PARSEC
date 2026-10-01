// window.arweaveWallet — ArConnect/Wander-compatible injected API.
//
// Why: the entire AO/Arweave ecosystem (sol.ar.io, ao.link, ao.arweave.dev,
// Permanotes, etc.) connects to wallets through this single object. By
// implementing the canonical surface, PARSEC becomes a drop-in wallet for
// every dApp without per-integration work.
//
// Custody invariant: every method that touches a private key goes through
// a vault-bridged ArweaveSigner held in a closure. The JWK is created once
// per connection, disposed on disconnect or lock. The window object never
// exposes the JWK or any signer internals.

import type Transaction from 'arweave/node/lib/transaction';
import { activeArweaveConfig, buildArweaveSigner, type ArweaveSigner } from './signer';
import { addressFromJwk } from './jwk';
import { store, getAccountAddress } from '../store';
import type { WalletAccount } from '../../types/wallet';
import { keystoreStatus } from '../keystore';

// ── Permission strings (ArConnect parity) ─────────────────────

export type ArweavePermission =
  | 'ACCESS_ADDRESS'
  | 'ACCESS_PUBLIC_KEY'
  | 'ACCESS_ALL_ADDRESSES'
  | 'SIGN_TRANSACTION'
  | 'ENCRYPT'
  | 'DECRYPT'
  | 'SIGNATURE'
  | 'ACCESS_ARWEAVE_CONFIG'
  | 'DISPATCH';

const PERM_STORAGE_PREFIX = 'parsec:arweave-perms:';

function permKey(origin: string): string {
  return `${PERM_STORAGE_PREFIX}${origin}`;
}

function loadPermissions(origin: string): ArweavePermission[] {
  try {
    const raw = localStorage.getItem(permKey(origin));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p === 'string') as ArweavePermission[];
  } catch {
    return [];
  }
}

function savePermissions(origin: string, perms: ArweavePermission[]): void {
  try {
    localStorage.setItem(permKey(origin), JSON.stringify(perms));
  } catch { /* quota / serialization — non-fatal */ }
}

function clearPermissions(origin: string): void {
  try { localStorage.removeItem(permKey(origin)); } catch { /* */ }
}

// ── Approval queue (consumed by views/arweave-approve.ts) ─────

export interface ArweaveApprovalRequest {
  id: string;
  origin: string;
  permissions: ArweavePermission[];
  appInfo?: { name?: string; logo?: string };
  createdAt: number;
}

interface PendingApproval {
  request: ArweaveApprovalRequest;
  resolve: (granted: ArweavePermission[]) => void;
  reject: (reason: string) => void;
}

let pendingApproval: PendingApproval | null = null;

export function getPendingArweaveApproval(): ArweaveApprovalRequest | null {
  return pendingApproval?.request ?? null;
}

export function resolveArweaveApproval(granted: ArweavePermission[]): void {
  if (!pendingApproval) return;
  const { resolve, request } = pendingApproval;
  pendingApproval = null;
  savePermissions(request.origin, granted);
  resolve(granted);
}

export function rejectArweaveApproval(reason: string = 'User rejected'): void {
  if (!pendingApproval) return;
  const { reject } = pendingApproval;
  pendingApproval = null;
  reject(reason);
}

async function requestApproval(
  origin: string,
  permissions: ArweavePermission[],
  appInfo?: { name?: string; logo?: string },
): Promise<ArweavePermission[]> {
  if (pendingApproval) {
    throw new Error('Another Arweave approval is already pending');
  }
  const request: ArweaveApprovalRequest = {
    id: `arw_${Date.now().toString(36)}`,
    origin,
    permissions,
    appInfo,
    createdAt: Date.now(),
  };
  return new Promise<ArweavePermission[]>((resolve, reject) => {
    pendingApproval = { request, resolve, reject };
    store.navigate('arweave-approve');
  });
}

// ── Connection state ─────────────────────────────────────────

interface ActiveConnection {
  origin: string;
  permissions: ArweavePermission[];
  signer: ArweaveSigner | null;
  address: string;
}

const connections = new Map<string, ActiveConnection>();

function originOf(): string {
  // dApp pages run in the same Tauri webview, so document.location.origin is
  // the dApp's origin. For internal PARSEC views (parsec://), we never call
  // the injected API.
  return typeof window !== 'undefined' ? window.location.origin : 'unknown';
}

function requirePermission(conn: ActiveConnection, perm: ArweavePermission): void {
  if (!conn.permissions.includes(perm)) {
    throw new Error(`PARSEC: missing permission ${perm} for ${conn.origin}`);
  }
}

async function ensureSigner(conn: ActiveConnection): Promise<ArweaveSigner> {
  if (conn.signer) return conn.signer;
  const passphrase = store.getPassphrase();
  if (!passphrase) {
    throw new Error('PARSEC: wallet is locked');
  }
  conn.signer = await buildArweaveSigner(conn.address, passphrase);
  return conn.signer;
}

function activeArweaveAccount(): { account: WalletAccount; address: string } | null {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) return null;
  const address = getAccountAddress(account, 'arweave')
    ?? getAccountAddress(account, 'arweave-hd');
  if (!address) return null;
  return { account, address };
}

// ── Injected API surface ─────────────────────────────────────

export interface ArweaveWalletAPI {
  walletName: string;
  walletVersion: string;
  connect(
    permissions: ArweavePermission[],
    appInfo?: { name?: string; logo?: string },
    gateway?: unknown,
  ): Promise<void>;
  disconnect(): Promise<void>;
  getActiveAddress(): Promise<string>;
  getActivePublicKey(): Promise<string>;
  getAllAddresses(): Promise<string[]>;
  getWalletNames(): Promise<Record<string, string>>;
  getPermissions(): Promise<ArweavePermission[]>;
  getArweaveConfig(): Promise<{ host: string; port: number; protocol: string }>;
  sign(tx: Transaction): Promise<Transaction>;
  dispatch(tx: Transaction): Promise<{ id: string; type: 'BASE' | 'BUNDLED' }>;
  signMessage(data: Uint8Array): Promise<Uint8Array>;
  verifyMessage(data: Uint8Array, signature: Uint8Array, publicKey?: string): Promise<boolean>;
  signDataItem(item: {
    data: string | Uint8Array;
    target?: string;
    anchor?: string;
    tags?: { name: string; value: string }[];
  }): Promise<ArrayBuffer>;
}

function getConnection(origin: string): ActiveConnection {
  const conn = connections.get(origin);
  if (!conn) throw new Error('PARSEC: not connected. Call connect() first.');
  return conn;
}

export function createArweaveWalletAPI(): ArweaveWalletAPI {
  return {
    walletName: 'PARSEC',
    walletVersion: '0.1.0',

    async connect(permissions, appInfo) {
      const origin = originOf();
      const status = await keystoreStatus();
      if (!status.unlocked) {
        throw new Error('PARSEC: wallet is locked. Open PARSEC and unlock first.');
      }
      const active = activeArweaveAccount();
      if (!active) {
        throw new Error('PARSEC: no Arweave account available. Create one in PARSEC first.');
      }

      // Honour cached permissions from prior approvals — if the dApp asks
      // for a subset of what's already granted, no prompt.
      const cached = loadPermissions(origin);
      const need = permissions.filter((p) => !cached.includes(p));
      const granted = need.length === 0 ? cached : await requestApproval(origin, permissions, appInfo);

      connections.set(origin, {
        origin,
        permissions: granted,
        signer: null, // built lazily on first signing call
        address: active.address,
      });

      window.dispatchEvent(new CustomEvent('walletSwitch', {
        detail: { address: active.address },
      }));
    },

    async disconnect() {
      const origin = originOf();
      const conn = connections.get(origin);
      if (conn?.signer) conn.signer.dispose();
      connections.delete(origin);
      clearPermissions(origin);
    },

    async getActiveAddress() {
      const conn = getConnection(originOf());
      requirePermission(conn, 'ACCESS_ADDRESS');
      return conn.address;
    },

    async getActivePublicKey() {
      const conn = getConnection(originOf());
      requirePermission(conn, 'ACCESS_PUBLIC_KEY');
      const signer = await ensureSigner(conn);
      return signer.publicKey;
    },

    async getAllAddresses() {
      const conn = getConnection(originOf());
      requirePermission(conn, 'ACCESS_ALL_ADDRESSES');
      const state = store.get();
      const out: string[] = [];
      for (const acc of state.accounts) {
        const a = getAccountAddress(acc, 'arweave') ?? getAccountAddress(acc, 'arweave-hd');
        if (a) out.push(a);
      }
      return out;
    },

    async getWalletNames() {
      const conn = getConnection(originOf());
      requirePermission(conn, 'ACCESS_ALL_ADDRESSES');
      const state = store.get();
      const out: Record<string, string> = {};
      for (const acc of state.accounts) {
        const a = getAccountAddress(acc, 'arweave') ?? getAccountAddress(acc, 'arweave-hd');
        if (a) out[a] = acc.name || 'PARSEC Account';
      }
      return out;
    },

    async getPermissions() {
      const origin = originOf();
      const conn = connections.get(origin);
      return conn?.permissions ?? loadPermissions(origin);
    },

    async getArweaveConfig() {
      const conn = getConnection(originOf());
      requirePermission(conn, 'ACCESS_ARWEAVE_CONFIG');
      return activeArweaveConfig();
    },

    async sign(tx) {
      const conn = getConnection(originOf());
      requirePermission(conn, 'SIGN_TRANSACTION');
      const signer = await ensureSigner(conn);
      return await signer.signTransaction(tx);
    },

    async dispatch(tx) {
      const conn = getConnection(originOf());
      requirePermission(conn, 'DISPATCH');
      const signer = await ensureSigner(conn);
      const receipt = await signer.dispatch(tx);
      return { id: receipt.id, type: 'BASE' };
    },

    async signMessage(data) {
      const conn = getConnection(originOf());
      requirePermission(conn, 'SIGNATURE');
      const signer = await ensureSigner(conn);
      return await signer.signMessage(data);
    },

    async verifyMessage(data, signature, publicKey) {
      const conn = getConnection(originOf());
      requirePermission(conn, 'SIGNATURE');
      if (publicKey && publicKey !== conn.address) {
        // Verifying against an external public key — do it statelessly.
        const externalAddress = await addressFromJwk({ kty: 'RSA', n: publicKey, e: 'AQAB' } as JsonWebKey);
        void externalAddress;
        const pub = await crypto.subtle.importKey(
          'jwk',
          { kty: 'RSA', n: publicKey, e: 'AQAB', alg: 'PS256', ext: true },
          { name: 'RSA-PSS', hash: 'SHA-256' },
          false,
          ['verify'],
        );
        return await crypto.subtle.verify(
          { name: 'RSA-PSS', saltLength: 32 },
          pub,
          signature as unknown as BufferSource,
          data as unknown as BufferSource,
        );
      }
      const signer = await ensureSigner(conn);
      return await signer.verifyMessage(data, signature);
    },

    async signDataItem(item) {
      const conn = getConnection(originOf());
      requirePermission(conn, 'SIGNATURE');
      const signer = await ensureSigner(conn);
      const signed = await signer.signDataItem({
        data: item.data,
        target: item.target,
        anchor: item.anchor,
        tags: item.tags,
      });
      return signed.raw.buffer.slice(
        signed.raw.byteOffset,
        signed.raw.byteOffset + signed.raw.byteLength,
      ) as ArrayBuffer;
    },
  };
}

// ── Lifecycle: install + uninstall ───────────────────────────

let installed = false;

/**
 * Install the injected API on `window.arweaveWallet`. Idempotent. Should be
 * called after the wallet is unlocked so the API can answer connect()
 * promptly. Subsequent locks dispose every active signer but keep the API
 * in place — re-unlocking re-enables it transparently.
 */
export function installArweaveWalletAPI(): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  (window as unknown as { arweaveWallet: ArweaveWalletAPI }).arweaveWallet = createArweaveWalletAPI();
  installed = true;
  window.dispatchEvent(new CustomEvent('arweaveWalletLoaded', { detail: { wallet: 'parsec' } }));
}

/** Dispose every connection's signer (e.g. on wallet lock). */
export function disposeArweaveConnections(): void {
  for (const conn of connections.values()) {
    if (conn.signer) conn.signer.dispose();
    conn.signer = null;
  }
}
