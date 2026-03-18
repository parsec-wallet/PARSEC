// Parsec Wallet — Entry Point
// Vanilla TypeScript. No frameworks. Blueprint CSS for styling.

import '@blueprintjs/core/lib/css/blueprint.css';
import '@blueprintjs/icons/lib/css/blueprint-icons.css';
import './styles/main.scss';

import { registerView, mountRouter } from './lib/router';
import { store } from './lib/store';
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

// Register all views
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

// Mount
const root = document.getElementById('root');
if (root) {
  mountRouter(root);
}

// Auto-lock: reset timer on any user activity
for (const event of ['click', 'keydown', 'input', 'mousemove'] as const) {
  document.addEventListener(event, () => store.onActivity(), { passive: true });
}
