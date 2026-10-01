// PARSEC Wallet — dApp Connect Approval View
// Shows transaction signing requests from web dApps connected via WebSocket.
// Follows the x402-confirm pattern: module-level pending state + setter.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { keystoreRetrieve } from '../lib/keystore';
import {
  connectApproveSign,
  connectRejectSign,
  connectPendingRequests,
  type SignRequest,
} from '../lib/connect';

// Module-level pending state (set before navigating to this view)
let pendingRequest: SignRequest | null = null;

/** Set the pending sign request before navigating to this view */
export function setConnectPending(request: SignRequest): void {
  pendingRequest = request;
}

/** Clear pending state */
export function clearConnectPending(): void {
  pendingRequest = null;
}

export function connectApproveView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];

  // If we have a specific pending request (from event), show it directly
  if (pendingRequest) {
    return buildSingleRequestView(pendingRequest, account?.address);
  }

  // Otherwise, load all pending requests
  return buildRequestListView(account?.address);
}

// ── Single request view (from event-driven navigation) ───────────

function buildSingleRequestView(req: SignRequest, address?: string): HTMLElement {
  return el('div', {
    cls: 'parsec-view parsec-confirm',
    children: [
      // Header
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Reject', {
            minimal: true, icon: 'arrow-left',
            onClick: () => handleReject(req),
          }),
          el('h2', { cls: 'parsec-view__title', text: 'dApp Sign Request' }),
        ],
      }),

      // Origin badge
      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-primary',
        children: [
          el('p', {
            text: `${req.origin} is requesting you sign ${req.txn_count} transaction(s)`,
          }),
        ],
      }),

      // Details
      el('div', {
        cls: 'parsec-confirm__details',
        children: [
          row('Origin', req.origin),
          row('Transactions', `${req.txn_count}`),
          req.message ? row('Message', req.message) : null,
          divider(),
          row('Request ID', `#${req.request_id}`),
          row('Time', new Date(req.created_at * 1000).toLocaleTimeString()),
          address ? row('Signing As', truncAddr(address)) : null,
        ].filter(Boolean) as HTMLElement[],
      }),

      // Warning
      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        children: [
          el('p', {
            text: 'Review carefully. Only approve transactions from dApps you trust. Signed transactions are irreversible on Algorand.',
          }),
        ],
      }),

      // Actions
      el('div', {
        cls: 'parsec-confirm__actions',
        children: [
          btn('Reject', {
            large: true, outlined: true,
            onClick: () => handleReject(req),
          }),
          btn('Approve & Sign', {
            intent: 'primary', large: true,
            onClick: () => handleApprove(req, address),
          }),
        ],
      }),
    ],
  });
}

// ── Request list view (manual navigation) ────────────────────────

function buildRequestListView(address?: string): HTMLElement {
  const container = el('div', {
    cls: 'parsec-view parsec-confirm',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', {
            minimal: true, icon: 'arrow-left',
            onClick: () => store.navigate('dashboard'),
          }),
          el('h2', { cls: 'parsec-view__title', text: 'dApp Requests' }),
        ],
      }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'Pending transaction signing requests from connected dApps.',
      }),
    ],
  });

  // Load requests asynchronously
  loadAndRenderRequests(container, address);
  return container;
}

async function loadAndRenderRequests(container: HTMLElement, address?: string) {
  try {
    const requests = await connectPendingRequests();

    if (requests.length === 0) {
      container.appendChild(
        el('div', {
          cls: 'parsec-empty',
          children: [el('p', { text: 'No pending sign requests.' })],
        }),
      );
      return;
    }

    for (const req of requests) {
      container.appendChild(buildRequestCard(req, address));
    }
  } catch (e) {
    toast(`Failed to load requests: ${e}`, 'danger');
  }
}

function buildRequestCard(req: SignRequest, address?: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__details',
    attrs: { style: 'margin-bottom: 16px;' },
    children: [
      row('Origin', req.origin),
      row('Transactions', `${req.txn_count}`),
      req.message ? row('Message', req.message) : null,
      row('Time', new Date(req.created_at * 1000).toLocaleTimeString()),
      el('div', {
        cls: 'parsec-confirm__actions',
        attrs: { style: 'margin-top: 12px;' },
        children: [
          btn('Reject', {
            outlined: true,
            onClick: () => handleReject(req),
          }),
          btn('Approve', {
            intent: 'primary',
            onClick: () => handleApprove(req, address),
          }),
        ],
      }),
    ].filter(Boolean) as HTMLElement[],
  });
}

// ── Handlers ─────────────────────────────────────────────────────

async function handleReject(req: SignRequest) {
  try {
    await connectRejectSign(req.request_id, 'User rejected');
    toast('Request rejected', 'primary');
  } catch (e) {
    toast(`Reject failed: ${e}`, 'danger');
  }
  pendingRequest = null;
  store.navigate('dashboard');
}

async function handleApprove(req: SignRequest, address?: string) {
  if (!address) {
    toast('No active account', 'danger');
    return;
  }

  const passphrase = store.getPassphrase();
  if (!passphrase) {
    toast('Session expired. Re-unlock wallet.', 'danger');
    store.navigate('unlock');
    return;
  }

  store.set({ isLoading: true });
  let mnemonic: string | null = null;

  try {
    mnemonic = await keystoreRetrieve(address, passphrase);
    if (!mnemonic) {
      toast('Could not retrieve key. Re-unlock.', 'danger');
      store.set({ isLoading: false });
      store.navigate('unlock');
      return;
    }

    // Sign each transaction
    const algosdk = await import('algosdk');
    const { sk } = algosdk.default.mnemonicToSecretKey(mnemonic.trim());

    const signedTxnsB64: string[] = [];
    for (const txnB64 of req.txns_b64) {
      const txnBytes = base64ToBytes(txnB64);
      const decoded = algosdk.default.decodeUnsignedTransaction(txnBytes);
      const signed = algosdk.default.signTransaction(decoded, sk);
      signedTxnsB64.push(bytesToBase64(signed.blob));
    }

    await connectApproveSign(req.request_id, signedTxnsB64);
    toast('Transaction signed and sent to dApp', 'success');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    toast(`Sign failed: ${msg}`, 'danger');
  } finally {
    mnemonic = null; // Zero out
    store.set({ isLoading: false });
    pendingRequest = null;
    store.navigate('dashboard');
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function row(label: string, value: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [
      el('span', { cls: 'parsec-confirm__label', text: label }),
      el('span', { cls: 'parsec-confirm__value', text: value }),
    ],
  });
}

function divider(): HTMLElement {
  return el('hr', { cls: 'parsec-confirm__divider' });
}

function truncAddr(a: string): string {
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
