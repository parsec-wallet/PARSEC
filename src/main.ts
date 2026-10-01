// PARSEC Wallet — Entry Point
// Vanilla TypeScript. No frameworks. Blueprint CSS for styling.

// Buffer polyfill for browser/Tauri webview — bip39 and xhd-wallet-api
// (used by the algorand-hd ARC-52 module) call Buffer.from at runtime.
import { Buffer as BufferPolyfill } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as unknown as { Buffer: typeof BufferPolyfill }).Buffer = BufferPolyfill;
}

// No Blueprint CSS: PARSEC styles the bp5-* class vocabulary itself
// (styles/components/_controls.scss). Blueprint stays the design reference.
import './styles/main.scss';
import './styles/pmvpn.scss';

import { registerView, mountRouter } from './lib/router';
import { createShell } from './views/shell';
import { mountPalette } from './lib/ui/palette';
import { store } from './lib/store';
import { initViewport } from './lib/viewport';
import { mountTitlebar } from './lib/ui/titlebar';
import { isTauri, isMobile } from './lib/platform';
import { initAppShell } from './lib/app-shell';

// Modules that register through the manifest (lib/modules.ts): one import,
// one registration for router + rail + dashboard. Lightspeed is the template.
import './lib/lightspeed/module';
import './lib/permaweb/module';
import './lib/x402/module';

// Eager — first-paint critical path. Together these cover every entry-point
// state (no wallet, locked wallet, unlocked wallet) and the onboarding flow.
import { matrixView } from './views/matrix';
import { onboardingView } from './views/onboarding';
import { unlockView } from './views/unlock';
import { dashboardView } from './views/dashboard';

import type { NameRequest, SignRequest } from './lib/connect';
import type { AppView } from './types/wallet';

// ── Lazy view loader ──────────────────────────────────────────
// Renders a placeholder synchronously (so the router never sees a Promise),
// then swaps in the real view once the chunk resolves. Failed chunk loads
// surface an inline error rather than a blank screen.
function lazyView(loader: () => Promise<() => HTMLElement>): () => HTMLElement {
  return () => {
    const placeholder = document.createElement('div');
    placeholder.className = 'parsec-view parsec-view--loading';
    placeholder.innerHTML = '<div class="parsec-view-loading__spinner" aria-hidden="true"></div>';
    loader()
      .then((factory) => {
        // Navigated away before the chunk arrived: building the view now would
        // register its listeners and timers into the NEXT view's cleanup list
        // (or nowhere at all), and nothing would ever show it.
        if (!placeholder.isConnected) return;
        const real = factory();
        real.classList.add('parsec-view--enter');
        placeholder.replaceWith(real);
        // Drop the enter class after the next frame so the fade-in plays once.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => real.classList.remove('parsec-view--enter'));
        });
      })
      .catch((err) => {
        placeholder.innerHTML = `<div class="parsec-error">Failed to load view: ${err instanceof Error ? err.message : String(err)}</div>`;
      });
    return placeholder;
  };
}

// Register eager views — only what can actually be the first thing on screen.
registerView('matrix', matrixView);
registerView('onboarding', onboardingView);
registerView('unlock', unlockView);
registerView('dashboard', dashboardView);

// Wallet creation and import are lazy. They are never the first paint — you
// arrive at them from onboarding — and eager-importing them pulled `algosdk`
// (~492 kB) onto the critical path, where the browser was told to
// `modulepreload` it before anything could render.
registerView('create-wallet', lazyView(async () => (await import('./views/create-wallet')).createWalletView));
registerView('verify-mnemonic', lazyView(async () => (await import('./views/verify-mnemonic')).verifyMnemonicView));
registerView('import-wallet', lazyView(async () => (await import('./views/import-wallet')).importWalletView));

// Register lazy views — keep one entry per view so chunk-name hints are stable.
registerView('send', lazyView(async () => (await import('./views/send')).sendView));
registerView('confirm-send', lazyView(async () => (await import('./views/confirm-send')).confirmSendView));
registerView('receive', lazyView(async () => (await import('./views/receive')).receiveView));
registerView('add-asset', lazyView(async () => (await import('./views/add-asset')).addAssetView));
registerView('create-select', lazyView(async () => (await import('./views/create-select')).createSelectView));
registerView('settings', lazyView(async () => (await import('./views/settings')).settingsView));
registerView('linkage', lazyView(async () => (await import('./views/linkage')).linkageView));
registerView('diagnostics', lazyView(async () => (await import('./views/diagnostics')).diagnosticsView));
registerView('swap', lazyView(async () => (await import('./views/swap')).swapView));
registerView('onramp', lazyView(async () => (await import('./views/onramp')).onrampView));
registerView('docs', lazyView(async () => (await import('./views/docs')).docsView));
registerView('identity', lazyView(async () => (await import('./views/identity')).identityView));
registerView('agents', lazyView(async () => (await import('./views/agents')).agentsView));
registerView('nfdominter', lazyView(async () => (await import('./views/nfdominter')).nfdominterView));
registerView('nfdominter-confirm', lazyView(async () => (await import('./views/nfdominter-confirm')).nfdominterConfirmView));
registerView('nfdominter-buy', lazyView(async () => (await import('./views/nfdominter-buy')).nfdominterBuyView));
registerView('mausoleum', lazyView(async () => (await import('./views/mausoleum')).mausoleumView));
registerView('admin-keygen', lazyView(async () => (await import('./views/admin-keygen')).adminKeygenView));
registerView('pmvpn', lazyView(async () => (await import('./views/pmvpn')).pmvpnView));
registerView('connect-approve', lazyView(async () => (await import('./views/connect-approve')).connectApproveView));
registerView('xchain-connect', lazyView(async () => (await import('./views/xchain-connect')).xchainConnectView));
registerView('arc52-create', lazyView(async () => (await import('./views/arc52-create')).arc52CreateView));
registerView('arweave-approve', lazyView(async () => (await import('./views/arweave-approve')).arweaveApproveView));
registerView('arweave-ario-migrate', lazyView(async () => (await import('./views/arweave-ario-migrate')).arweaveArioMigrateView));
registerView('solana-create', lazyView(async () => (await import('./views/solana-create')).solanaCreateView));
registerView('solana-send', lazyView(async () => (await import('./views/solana-send')).solanaSendView));
registerView('ario-migrate-solana', lazyView(async () => (await import('./views/ario-migrate-solana')).arioMigrateSolanaView));
registerView('arweave-create', lazyView(async () => (await import('./views/arweave-create')).arweaveCreateView));
registerView('arweave-send', lazyView(async () => (await import('./views/arweave-send')).arweaveSendView));
registerView('ario-claim-pythai', lazyView(async () => (await import('./views/ario-claim-pythai')).arioClaimPythaiView));
registerView('bankon-hub', lazyView(async () => (await import('./views/bankon-hub')).bankonHubView));
registerView('bankon-claim', lazyView(async () => (await import('./views/bankon-claim')).bankonClaimView));
registerView('bankon-name', lazyView(async () => (await import('./views/bankon-name')).bankonNameView));
registerView('bankon-resolve', lazyView(async () => (await import('./views/bankon-resolve')).bankonResolveView));
registerView('bankon-admin', lazyView(async () => (await import('./views/bankon-admin')).bankonAdminView));
registerView('ario-hub', lazyView(async () => (await import('./views/ario-hub')).arioHubView));
registerView('ario-claim', lazyView(async () => (await import('./views/ario-claim')).arioClaimView));
registerView('ario-name', lazyView(async () => (await import('./views/ario-name')).arioNameView));
registerView('ario-transfer', lazyView(async () => (await import('./views/ario-transfer')).arioTransferView));
registerView('ario-resolve', lazyView(async () => (await import('./views/ario-resolve')).arioResolveView));
registerView('name-mint', lazyView(async () => (await import('./views/name-mint')).nameMintView));
registerView('name-hub', lazyView(async () => {
  await import('./lib/namespaces'); // ensure adapters self-register
  return (await import('./views/name-hub')).nameHubView;
}));
registerView('name-claim', lazyView(async () => {
  await import('./lib/namespaces');
  return (await import('./views/name-claim')).nameClaimView;
}));
registerView('name-manage', lazyView(async () => {
  await import('./lib/namespaces');
  return (await import('./views/name-manage')).nameManageView;
}));
registerView('connect-name-approve', lazyView(async () => {
  await import('./lib/namespaces');
  return (await import('./views/connect-name-approve')).connectNameApproveView;
}));
registerView('name-controller', lazyView(async () => {
  await import('./lib/namespaces');
  return (await import('./views/name-controller')).nameControllerView;
}));
registerView('name-resolve', lazyView(async () => {
  await import('./lib/namespaces');
  return (await import('./views/name-resolve')).nameResolveView;
}));
registerView('market-hub', lazyView(async () => (await import('./views/market-hub')).marketHubView));
registerView('market-listing', lazyView(async () => (await import('./views/market-listing')).marketListingView));
registerView('market-create', lazyView(async () => (await import('./views/market-create')).marketCreateView));
registerView('market-auction', lazyView(async () => (await import('./views/market-auction')).marketAuctionView));
registerView('solana-import', lazyView(async () => (await import('./views/solana-import')).solanaImportView));

// Mount — the router renders into the shell's content host, not the document
// root, so the shell (brand, tier rail, breadcrumb) survives navigation.
const root = document.getElementById('root');
if (root) {
  // Desktop: the window is undecorated, so the title bar is ours (and the tray,
  // close-to-tray and start-at-login are wired to Rust). Mounted before the
  // viewport is measured so the app height accounts for it.
  // A phone has no window chrome, tray or start at login: the system owns all three.
  if (isTauri && !isMobile) {
    mountTitlebar();
    void initAppShell();
  }
  // Before first paint: every screen sizes itself to the window it is in.
  initViewport(isMobile);
  if (isMobile) void import('./lib/mobile').then((m) => m.initMobile());
  const shell = createShell();
  root.appendChild(shell.element);
  mountRouter(shell.content);
  mountPalette();
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
for (const event of ['click', 'keydown', 'input', 'mousemove', 'touchstart', 'scroll'] as const) {
  document.addEventListener(event, () => store.onActivity(), { passive: true });
}

// ── Idle-time preload ────────────────────────────────────────
// Once the user reaches the dashboard, prefetch the views they're most
// likely to navigate to next so the lazy spinner is rarely visible.
const PRELOAD_FROM_DASHBOARD: ReadonlyArray<() => Promise<unknown>> = [
  () => import('./views/send'),
  () => import('./views/confirm-send'),
  () => import('./views/receive'),
  () => import('./views/add-asset'),
  () => import('./views/settings'),
];

const idle: (cb: () => void) => void =
  typeof (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback === 'function'
    ? (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback
    : (cb) => setTimeout(cb, 200);

let preloaded: Set<AppView> = new Set();
function preloadFor(view: AppView): void {
  if (view !== 'dashboard' || preloaded.has(view)) return;
  preloaded.add(view);
  for (const load of PRELOAD_FROM_DASHBOARD) {
    idle(() => { load().catch(() => { /* preload best-effort */ }); });
  }
}

// ── Deferred Tauri IPC plumbing ──────────────────────────────
// Wire the dApp sign-request listener and connect-server auto-start AFTER
// first paint so they don't block initial render. Tauri-only paths are
// gated through the platform shim so the permaweb-served web build never
// pulls @tauri-apps/api into its chunk graph.
function deferredInit(): void {
  // The desktop records the open profile on disk; if this window's record
  // disagrees (storage cleared, changed elsewhere), the disk wins.
  void import('./lib/profiles').then(async ({ reconcileProfile }) => {
    const name = await reconcileProfile();
    if (name) await store.useProfile(name, { backend: false });
  }).catch(() => { /* a build without profiles */ });
  import('./lib/platform').then(async ({ isTauri, listen }) => {
    if (!isTauri) return;
    // Listen for dApp sign requests from the connect WebSocket server.
    // When a request arrives, lazy-load connect-approve and navigate.
    await listen<SignRequest>('parsec-connect-sign-request', (event) => {
      const state = store.get();
      if (state.accounts.length === 0) return;
      import('./views/connect-approve').then(({ setConnectPending }) => {
        setConnectPending(event.payload);
        store.navigate('connect-approve');
      });
    });

    // Listen for dApp name-management requests (parsec_nameRequest). Unlike a raw sign
    // request these carry an intent, so the approval view can state it in words.
    await listen<NameRequest>('parsec-connect-name-request', (event) => {
      const state = store.get();
      if (state.accounts.length === 0) return;
      Promise.all([
        import('./lib/namespaces'),                       // adapters must be registered first
        import('./views/connect-name-approve'),
      ]).then(([, { setNamePending }]) => {
        setNamePending(event.payload);
        store.navigate('connect-name-approve');
      });
    });

    // Auto-start connect server when the wallet reaches the dashboard.
    const { connectStart } = await import('./lib/connect');
    // Start the bridge once per address, and only for an armed wallet. This
    // used to fire on every store change while on the dashboard; Rust refused
    // the repeats, but each was still an IPC round trip.
    const { isArmed, onModeChange } = await import('./lib/mode');
    let bridgeFor: string | null = null;
    onModeChange((m) => { if (m === 'viewing') bridgeFor = null; });
    store.subscribe((state) => {
      preloadFor(state.view);
      // Not on a phone: the bridge's defence is that only this machine can reach
      // 127.0.0.1 (threat model A5), and on Android every installed app shares the
      // device's loopback. A phone would expose the signing bridge to its other apps.
      if (isMobile) return;
      if (isArmed() && state.accounts.length > 0 && state.view === 'dashboard') {
        const address = state.accounts[state.activeAccountIndex]?.address;
        if (address && address !== bridgeFor) {
          bridgeFor = address;
          connectStart(address).catch(() => { /* may already be running */ });
        }
      }
    });
  });

  // Install window.arweaveWallet once the wallet is unlocked; dispose every
  // active signer (but keep the API installed) when the wallet locks.
  import('./lib/arweave/inject').then(({ installArweaveWalletAPI, disposeArweaveConnections }) => {
    let lastUnlocked = false;
    store.subscribe((state) => {
      const unlocked = state.accounts.length > 0 && state.view !== 'matrix' && state.view !== 'unlock';
      if (unlocked && !lastUnlocked) installArweaveWalletAPI();
      if (!unlocked && lastUnlocked) disposeArweaveConnections();
      lastUnlocked = unlocked;
    });
  });
}

if (document.readyState === 'complete') {
  idle(deferredInit);
} else {
  window.addEventListener('load', () => idle(deferredInit), { once: true });
}
