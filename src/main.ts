// Parsec Wallet — Entry Point
// Vanilla TypeScript. No frameworks. Blueprint CSS for styling.

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
import { docsView } from './views/docs';
import { settingsView } from './views/settings';
import { pmvpnView } from './views/pmvpn';
import { x402ConfirmView } from './views/x402-confirm';
import { agentsView } from './views/agents';
import { identityView } from './views/identity';
import { connectApproveView, setConnectPending } from './views/connect-approve';
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
registerView('docs', docsView);
registerView('settings', settingsView);
registerView('pmvpn', pmvpnView);
registerView('x402-confirm', x402ConfirmView);
registerView('agents', agentsView);
registerView('identity', identityView);
registerView('connect-approve', connectApproveView);

// Mount
const root = document.getElementById('root');
if (root) {
  mountRouter(root);
}

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
