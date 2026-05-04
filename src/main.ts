// Parsec Wallet — Entry Point
// Vanilla TypeScript. No frameworks. Blueprint CSS for styling.

// Buffer polyfill for browser/Tauri webview — bip39 and xhd-wallet-api
// (used by the algorand-hd ARC-52 module) call Buffer.from at runtime.
import { Buffer as BufferPolyfill } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as unknown as { Buffer: typeof BufferPolyfill }).Buffer = BufferPolyfill;
}

import '@blueprintjs/core/lib/css/blueprint.css';
import '@blueprintjs/icons/lib/css/blueprint-icons.css';
import './styles/main.scss';

import { registerView, mountRouter } from './lib/router';
import { store } from './lib/store';
import { matrixView } from './views/matrix';
import { onboardingView } from './views/onboarding';
import { createWalletView } from './views/create-wallet';
import { verifyMnemonicView } from './views/verify-mnemonic';
import { importWalletView } from './views/import-wallet';
import { unlockView } from './views/unlock';
import { dashboardView } from './views/dashboard';
import { sendView } from './views/send';
import { confirmSendView } from './views/confirm-send';
import { receiveView } from './views/receive';
import { addAssetView } from './views/add-asset';
import { swapView } from './views/swap';
import { onrampView } from './views/onramp';
import { docsView } from './views/docs';
import { settingsView } from './views/settings';
import { pmvpnView } from './views/pmvpn';
import { x402ConfirmView } from './views/x402-confirm';
import { agentsView } from './views/agents';
import { identityView } from './views/identity';
import { connectApproveView, setConnectPending } from './views/connect-approve';
import { adminKeygenView } from './views/admin-keygen';
import { mausoleumView } from './views/mausoleum';
import { connectStart } from './lib/connect';
import type { SignRequest } from './lib/connect';
import './styles/pmvpn.scss';

// Register all views
registerView('matrix', matrixView);
registerView('onboarding', onboardingView);
registerView('create-wallet', createWalletView);
registerView('verify-mnemonic', verifyMnemonicView);
registerView('import-wallet', importWalletView);
registerView('unlock', unlockView);
registerView('dashboard', dashboardView);
registerView('send', sendView);
registerView('confirm-send', confirmSendView);
registerView('receive', receiveView);
registerView('add-asset', addAssetView);
registerView('swap', swapView);
registerView('onramp', onrampView);
registerView('docs', docsView);
registerView('settings', settingsView);
registerView('pmvpn', pmvpnView);
registerView('x402-confirm', x402ConfirmView);
registerView('agents', agentsView);
registerView('identity', identityView);
registerView('connect-approve', connectApproveView);
registerView('admin-keygen', adminKeygenView);
registerView('mausoleum', mausoleumView);

// Lazy-loaded views — pull in heavy crypto libs (libsodium for ARC-52,
// algokit-utils for xchain) only when the user navigates to them. Without
// this, libsodium's top-level await + bip39's Buffer use can block initial
// app load and produce a blank screen.
function lazyView(loader: () => Promise<() => HTMLElement>): () => HTMLElement {
  return () => {
    const placeholder = document.createElement('div');
    placeholder.className = 'parsec-view parsec-view--loading';
    placeholder.innerHTML = '<div class="bp5-spinner bp5-large"><div class="bp5-spinner-animation"></div></div>';
    loader().then((factory) => {
      const real = factory();
      placeholder.replaceWith(real);
    }).catch((err) => {
      placeholder.innerHTML = `<div class="parsec-error">Failed to load view: ${err instanceof Error ? err.message : String(err)}</div>`;
    });
    return placeholder;
  };
}
registerView('xchain-connect', lazyView(async () => (await import('./views/xchain-connect')).xchainConnectView));
registerView('arc52-create', lazyView(async () => (await import('./views/arc52-create')).arc52CreateView));

// Mount
const root = document.getElementById('root');
if (root) {
  mountRouter(root);
}

// Global loading overlay — responds to store.isLoading
const loadingOverlay = document.createElement('div');
loadingOverlay.className = 'parsec-loading-overlay';
loadingOverlay.innerHTML = '<div class="parsec-loading-spinner"></div>';
document.body.appendChild(loadingOverlay);

store.subscribe((state) => {
  loadingOverlay.classList.toggle('parsec-loading-overlay--active', state.isLoading);
});

// Auto-lock: reset timer on any user activity
for (const event of ['click', 'keydown', 'input', 'mousemove'] as const) {
  document.addEventListener(event, () => store.onActivity(), { passive: true });
}

// Listen for dApp sign requests from the connect WebSocket server
// When a dApp requests signing, navigate to the approval view
import { listen } from '@tauri-apps/api/event';
listen<SignRequest>('parsec-connect-sign-request', (event) => {
  const state = store.get();
  // Only show if wallet is unlocked (has accounts)
  if (state.accounts.length > 0) {
    setConnectPending(event.payload);
    store.navigate('connect-approve');
  }
});

// Auto-start connect server when wallet unlocks (if user has accounts)
store.subscribe((state) => {
  if (state.accounts.length > 0 && state.view === 'dashboard') {
    const address = state.accounts[state.activeAccountIndex]?.address;
    if (address) {
      connectStart(address).catch(() => {
        // Connect server may already be running or unavailable — that's fine
      });
    }
  }
});
