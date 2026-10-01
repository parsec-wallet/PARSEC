// PARSEC Wallet — State Store
// PARSEC never holds private keys. Sensitive data (passphrase, mnemonic)
// is held in private class fields — never serialized, never in localStorage.

import type { WalletState, AppView, PendingSend, WalletAccount } from '../types/wallet';
import type { ChainId } from './pouch/types';
import { isTauri } from './vault';
import { keystoreLock } from './keystore';
import { defaultAvatarFor } from './avatars';
import { isModalRoute } from './nav';
import { stateKey, webKeysKey, activeProfile, selectProfileBackend, setActiveProfileLocal } from './profiles';

type Listener = (state: WalletState) => void;

// The account mirror is per profile: `parsec-wallet-state` for the default
// profile (the key it always had), `parsec-wallet-state@<name>` for others.

// Older persisted accounts predate the multi-chain `chains` map.
// Backfill so every account has at least { algorand: <primary address> }.
function migrateAccount(raw: unknown): WalletAccount {
  const a = raw as Partial<WalletAccount> & { address: string };
  const chains = (a.chains && typeof a.chains === 'object') ? { ...a.chains } : {};
  if (a.address && !chains['algorand']) chains['algorand'] = a.address;
  return {
    address: a.address,
    name: a.name ?? 'Account',
    createdAt: a.createdAt ?? Date.now(),
    watchOnly: a.watchOnly,
    chains,
    activeChain: a.activeChain ?? 'algorand',
    avatar: a.avatar ?? defaultAvatarFor(a.address),
  };
}

function loadPersistedState(): Partial<WalletState> {
  try {
    const raw = localStorage.getItem(stateKey());
    if (!raw) return {};
    const saved = JSON.parse(raw);
    const accounts = Array.isArray(saved.accounts) ? saved.accounts.map(migrateAccount) : [];
    return {
      accounts,
      activeAccountIndex: saved.activeAccountIndex || 0,
      settings: saved.settings || undefined,
    };
  } catch {
    return {};
  }
}

/** Get the address an account uses on a specific chain. Falls back to the
 * primary `address` when the chain is unmapped (legacy Algorand-only accounts). */
export function getAccountAddress(account: WalletAccount, chainId: ChainId): string | undefined {
  if (account.chains && account.chains[chainId]) return account.chains[chainId];
  if (chainId === 'algorand') return account.address;
  return undefined;
}

/** Set the address an account uses on a specific chain. Returns a new
 * WalletAccount — caller is responsible for persisting via store.set(). */
export function setAccountAddress(
  account: WalletAccount,
  chainId: ChainId,
  address: string,
): WalletAccount {
  return {
    ...account,
    chains: { ...account.chains, [chainId]: address },
  };
}

function persistState(state: WalletState): void {
  const safe = {
    accounts: state.accounts,
    activeAccountIndex: state.activeAccountIndex,
    settings: state.settings,
  };
  localStorage.setItem(stateKey(), JSON.stringify(safe));
}

function defaultState(): WalletState {
  const persisted = loadPersistedState();

  return {
    view: 'matrix',
    accounts: persisted.accounts || [],
    activeAccountIndex: persisted.activeAccountIndex || 0,
    accountInfo: null,
    transactions: [],
    settings: persisted.settings || {
      network: 'mainnet',
      autoLockMinutes: 5,
      showTestnetWarning: true,
    },
    isLoading: false,
    error: null,
  };
}

class Store {
  private state: WalletState;
  private listeners: Set<Listener> = new Set();

  // Sensitive data — NEVER persisted, NEVER serialized, NEVER in localStorage
  private _sessionPassphrase: string | null = null;
  private _tempMnemonic: string | null = null;
  private _pendingSend: PendingSend | null = null;

  // Auto-lock
  private _lockTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the countdown last restarted (ms): lets a resumed app check the idle time itself. */
  private _lockFrom = 0;

  constructor() {
    this.state = defaultState();
  }

  get(): WalletState {
    return this.state;
  }

  // --- Sensitive data accessors (never touch localStorage) ---

  getPassphrase(): string | null { return this._sessionPassphrase; }
  setPassphrase(p: string | null): void { this._sessionPassphrase = p; this.resetLockTimer(); }

  getTempMnemonic(): string | null { return this._tempMnemonic; }
  setTempMnemonic(m: string | null): void { this._tempMnemonic = m; }

  getPendingSend(): PendingSend | null { return this._pendingSend; }
  setPendingSend(p: PendingSend | null): void { this._pendingSend = p; }

  // --- State management ---

  set(partial: Partial<WalletState>): void {
    // Normalize any incoming accounts so the chains map is always present.
    // Callers (create-wallet, import-wallet) can stay schema-agnostic.
    if (partial.accounts) {
      partial = { ...partial, accounts: partial.accounts.map(migrateAccount) };
    }
    this.state = { ...this.state, ...partial };
    persistState(this.state);
    this.notify();
  }

  /**
   * Views visited, most recent last. Not persisted: a back stack that survives a
   * restart would let a gesture walk into a context the participant never opened.
   */
  private history: AppView[] = [];

  navigate(view: AppView): void {
    const from = this.state.view;
    // An approval surface never joins the stack. A back gesture must not be able to
    // silently cancel — or silently re-enter — a signing decision, which is the same
    // rule `nav.ts` states with `modal: true` and `isModalRoute()` enforces.
    if (from && from !== view && !isModalRoute(from)) {
      this.history.push(from);
      if (this.history.length > 50) this.history.shift();
    }
    this.set({ view, error: null });
  }

  /** Whether there is anywhere to go back to. */
  canGoBack(): boolean {
    return this.history.length > 0;
  }

  /**
   * Return to the previous view, or to the dashboard when there is none.
   *
   * Never a no-op: a back control that sometimes does nothing reads as broken, and the
   * dashboard is always a defensible place to be.
   */
  /** Go to the previous view. Returns false, without navigating, when there is
   *  no history, so callers choose their own fallback. */
  back(): boolean {
    const previous = this.history.pop();
    if (previous === undefined) return false;
    this.set({ view: previous, error: null });
    return true;
  }

  /** Switch the active account and the chain it is viewed on. Clears the
   *  cached Algorand account data (stale across a switch) and routes to the
   *  dashboard. Single switch path for the wallet switcher and the per-chain
   *  create flows (solana-create, arweave-create). */
  selectChain(accountIndex: number, chainId: ChainId): void {
    const accounts = [...this.state.accounts];
    const acct = accounts[accountIndex];
    if (!acct) return;
    accounts[accountIndex] = { ...acct, activeChain: chainId };
    this.set({ accounts, activeAccountIndex: accountIndex, accountInfo: null, transactions: [] });
    this.navigate('dashboard');
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  // --- Session lifecycle ---

  lock(): void {
    // Zero every sensitive field — leave no trace
    if (this._sessionPassphrase) {
      this._sessionPassphrase = '\0'.repeat(this._sessionPassphrase.length);
      this._sessionPassphrase = '';
    }
    this._sessionPassphrase = null;

    if (this._tempMnemonic) {
      this._tempMnemonic = '\0'.repeat(this._tempMnemonic.length);
      this._tempMnemonic = '';
    }
    this._tempMnemonic = null;

    this._pendingSend = null;

    // Clear all cached chain data, and the back stack: after a lock a back
    // gesture must not walk into a view from the session that just ended.
    this.clearLockTimer();
    this.history = [];
    this.set({ accountInfo: null, transactions: [], error: null, isLoading: false });

    // Lock the Tauri vault session if available
    if (isTauri()) keystoreLock();

    // Disconnect all pmVPN sessions
    import('./pmvpn/connector').then(c => c.disconnectAll()).catch(() => {});

    this.navigate('matrix');
  }

  /** The profile whose vault and wallets this window is using. */
  get profile(): string {
    return activeProfile();
  }

  /**
   * Switch to another profile: its vault, its wallets. The open session ends
   * first (Rust locks the vault when the profile changes), then the account
   * list is reloaded from the new profile's mirror. A profile seen for the
   * first time inherits the current settings rather than the factory ones.
   * `backend: false` when Rust already recorded the profile (start-up sync).
   */
  async useProfile(name: string, opts: { backend?: boolean } = {}): Promise<void> {
    const settings = this.state.settings;
    if (opts.backend === false) setActiveProfileLocal(name);
    else await selectProfileBackend(name);

    if (this._sessionPassphrase) this._sessionPassphrase = '\0'.repeat(this._sessionPassphrase.length);
    if (this._tempMnemonic) this._tempMnemonic = '\0'.repeat(this._tempMnemonic.length);
    this._sessionPassphrase = null;
    this._tempMnemonic = null;
    this._pendingSend = null;
    this.clearLockTimer();
    this.history = [];

    const fresh = localStorage.getItem(stateKey()) === null;
    const next = defaultState();
    this.state = { ...next, view: this.state.view, settings: fresh ? settings : next.settings };
    if (fresh) persistState(this.state);
    this.notify();
  }

  reset(): void {
    if (this._sessionPassphrase) this._sessionPassphrase = '\0'.repeat(this._sessionPassphrase.length);
    if (this._tempMnemonic) this._tempMnemonic = '\0'.repeat(this._tempMnemonic.length);
    this._sessionPassphrase = null;
    this._tempMnemonic = null;
    this._pendingSend = null;
    this.clearLockTimer();
    localStorage.removeItem(stateKey());
    localStorage.removeItem(webKeysKey());
    this.state = defaultState();
    this.notify();
  }

  // --- Auto-lock timer ---

  resetLockTimer(): void {
    this.clearLockTimer();
    const minutes = this.state.settings.autoLockMinutes;
    this._lockFrom = Date.now();
    if (minutes > 0 && this._sessionPassphrase) {
      // Auto-lock is a complete logout, not a partial one: an armed wallet
      // left idle must end up exactly where the Logout button leaves it.
      this._lockTimer = setTimeout(() => {
        void import('./session').then((m) => m.logout()).catch(() => this.lock());
      }, minutes * 60 * 1000);
    }
  }

  clearLockTimer(): void {
    if (this._lockTimer) {
      clearTimeout(this._lockTimer);
      this._lockTimer = null;
    }
  }

  /** Call on user activity to reset the auto-lock countdown */
  onActivity(): void {
    if (this._sessionPassphrase) {
      this.resetLockTimer();
    }
  }

  /**
   * On returning to the foreground: a phone may hold back timers while the app is in the
   * background, so the idle time is measured, not trusted to the timer. True when it locked.
   */
  lockIfIdleTooLong(): boolean {
    const minutes = this.state.settings.autoLockMinutes;
    if (minutes > 0 && this._sessionPassphrase && this._lockFrom && Date.now() - this._lockFrom >= minutes * 60_000) {
      this.clearLockTimer();
      void import('./session').then((m) => m.logout()).catch(() => this.lock());
      return true;
    }
    return false;
  }
}

export const store = new Store();
