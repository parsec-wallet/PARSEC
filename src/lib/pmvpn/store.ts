// pmVPN Module — State Store
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Follows PARSEC's store pattern. Connection profiles persisted
// in localStorage, sessions held in memory only.

import type { PmvpnHost, PmvpnSession, PmvpnState, PmvpnConnectionState } from './types';

const STORAGE_KEY = 'pmvpn-hosts';

type Listener = (state: PmvpnState) => void;

function loadHosts(): PmvpnHost[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistHosts(hosts: PmvpnHost[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts));
}

class PmvpnStore {
  private state: PmvpnState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = {
      hosts: loadHosts(),
      activeHostId: null,
      sessions: new Map(),
      connectionState: 'disconnected',
      error: null,
    };
  }

  get(): PmvpnState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  // --- Host management ---

  addHost(host: PmvpnHost): void {
    this.state.hosts.push(host);
    persistHosts(this.state.hosts);
    this.notify();
  }

  removeHost(id: string): void {
    this.state.hosts = this.state.hosts.filter(h => h.id !== id);
    persistHosts(this.state.hosts);
    if (this.state.activeHostId === id) {
      this.state.activeHostId = null;
    }
    this.notify();
  }

  setActiveHost(id: string | null): void {
    this.state.activeHostId = id;
    this.notify();
  }

  getActiveHost(): PmvpnHost | null {
    if (!this.state.activeHostId) return null;
    return this.state.hosts.find(h => h.id === this.state.activeHostId) || null;
  }

  // --- Connection state ---

  setConnectionState(state: PmvpnConnectionState, error?: string): void {
    this.state.connectionState = state;
    this.state.error = error || null;
    this.notify();
  }

  // --- Sessions ---

  addSession(session: PmvpnSession): void {
    this.state.sessions.set(session.hostId, session);
    this.notify();
  }

  removeSession(hostId: string): void {
    this.state.sessions.delete(hostId);
    this.notify();
  }

  getSession(hostId: string): PmvpnSession | undefined {
    return this.state.sessions.get(hostId);
  }

  // --- Cleanup on lock ---

  clearSessions(): void {
    this.state.sessions.clear();
    this.state.connectionState = 'disconnected';
    this.state.error = null;
    this.notify();
  }
}

export const pmvpnStore = new PmvpnStore();
