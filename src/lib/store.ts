// Parsec Wallet — State Store
// Parsec never holds private keys. Sensitive data (passphrase, mnemonic)
// is held in private class fields — never serialized, never in localStorage.

import type { WalletState, AppView, PendingSend } from '../types/wallet';

type Listener = (state: WalletState) => void;

const STORAGE_KEY = 'parsec-wallet-state';

function loadPersistedState(): Partial<WalletState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    return {
      accounts: saved.accounts || [],
      activeAccountIndex: saved.activeAccountIndex || 0,
      settings: saved.settings || undefined,
    };
  } catch {
    return {};
  }
}

function persistState(state: WalletState): void {
  const safe = {
    accounts: state.accounts,
    activeAccountIndex: state.activeAccountIndex,
    settings: state.settings,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

function defaultState(): WalletState {
  const persisted = loadPersistedState();
  const hasAccounts = persisted.accounts && persisted.accounts.length > 0;

  return {
    view: hasAccounts ? 'unlock' : 'onboarding',
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
    this.state = { ...this.state, ...partial };
    persistState(this.state);
    this.notify();
  }

  navigate(view: AppView): void {
    this.set({ view, error: null });
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
    // Zero sensitive strings before nullifying (best effort — JS strings are immutable)
    if (this._sessionPassphrase) this._sessionPassphrase = '\0'.repeat(this._sessionPassphrase.length);
    if (this._tempMnemonic) this._tempMnemonic = '\0'.repeat(this._tempMnemonic.length);
    this._sessionPassphrase = null;
    this._tempMnemonic = null;
    this._pendingSend = null;
    this.clearLockTimer();
    this.set({ accountInfo: null, transactions: [] });
    this.navigate('unlock');
  }

  reset(): void {
    if (this._sessionPassphrase) this._sessionPassphrase = '\0'.repeat(this._sessionPassphrase.length);
    if (this._tempMnemonic) this._tempMnemonic = '\0'.repeat(this._tempMnemonic.length);
    this._sessionPassphrase = null;
    this._tempMnemonic = null;
    this._pendingSend = null;
    this.clearLockTimer();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('parsec-encrypted-keys');
    this.state = defaultState();
    this.notify();
  }

  // --- Auto-lock timer ---

  resetLockTimer(): void {
    this.clearLockTimer();
    const minutes = this.state.settings.autoLockMinutes;
    if (minutes > 0 && this._sessionPassphrase) {
      this._lockTimer = setTimeout(() => this.lock(), minutes * 60 * 1000);
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
}

export const store = new Store();
