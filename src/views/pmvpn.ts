// pmVPN View — Remote Machine Manager
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: GPL-3.0-only
//
// Vanilla TypeScript using Parsec's dom.ts helpers.
// Layout: host sidebar | terminal | status bar

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { pmvpnStore } from '../lib/pmvpn/store';
import { connectToHost, disconnectFromHost } from '../lib/pmvpn/connector';
import { createTerminal, mountTerminal, type TerminalInstance } from '../lib/pmvpn/terminal';
import type { PmvpnHost } from '../lib/pmvpn/types';

let activeTerminal: TerminalInstance | null = null;

export function pmvpnView(): HTMLElement {
  const root = el('div', { cls: 'pmvpn-layout' });

  // --- Sidebar: host list + add host ---
  const sidebar = el('div', { cls: 'pmvpn-sidebar' });

  const header = el('div', { cls: 'pmvpn-sidebar-header', children: [
    el('h3', { text: 'pmVPN' }),
    btn('Back', {
      minimal: true,
      icon: 'arrow-left',
      onClick: () => store.navigate('dashboard'),
    }),
  ]});
  sidebar.appendChild(header);

  const hostList = el('div', { cls: 'pmvpn-host-list' });
  sidebar.appendChild(hostList);

  sidebar.appendChild(buildAddHostForm());

  // --- Main area: terminal ---
  const main = el('div', { cls: 'pmvpn-main' });
  const termContainer = el('div', { cls: 'pmvpn-terminal' });
  const placeholder = el('div', { cls: 'pmvpn-placeholder', text: 'Select a host to connect' });
  main.appendChild(placeholder);
  main.appendChild(termContainer);

  // --- Status bar ---
  const statusBar = el('div', { cls: 'pmvpn-status' });

  root.append(sidebar, main, statusBar);

  // --- Render host list ---
  function renderHosts(): void {
    hostList.innerHTML = '';
    const state = pmvpnStore.get();

    if (state.hosts.length === 0) {
      hostList.appendChild(el('div', { cls: 'pmvpn-empty', text: 'No hosts configured' }));
      return;
    }

    for (const host of state.hosts) {
      const session = state.sessions.get(host.id);
      const isActive = state.activeHostId === host.id;
      const isConnected = session?.connected ?? false;

      const item = el('div', {
        cls: `pmvpn-host-item ${isActive ? 'active' : ''} ${isConnected ? 'connected' : ''}`,
        children: [
          el('div', { cls: 'pmvpn-host-name', text: host.name }),
          el('div', { cls: 'pmvpn-host-addr', text: `${host.host}:${host.basePort}` }),
          el('div', { cls: 'pmvpn-host-status', text: isConnected ? 'connected' : 'offline' }),
        ],
        onClick: () => {
          pmvpnStore.setActiveHost(host.id);
          if (!isConnected) {
            handleConnect(host);
          } else if (session) {
            showTerminal(session.id);
          }
        },
      });

      // Disconnect / Remove buttons
      const actions = el('div', { cls: 'pmvpn-host-actions' });
      if (isConnected) {
        actions.appendChild(btn('Disconnect', {
          minimal: true, intent: 'warning',
          onClick: (e) => { e.stopPropagation(); handleDisconnect(host.id); },
        }));
      }
      actions.appendChild(btn('Remove', {
        minimal: true, intent: 'danger',
        onClick: (e) => { e.stopPropagation(); pmvpnStore.removeHost(host.id); renderHosts(); },
      }));
      item.appendChild(actions);

      hostList.appendChild(item);
    }
  }

  // --- Connection handler ---
  async function handleConnect(host: PmvpnHost): Promise<void> {
    updateStatus('Connecting...');
    try {
      const sessionId = await connectToHost(host);
      showTerminal(sessionId);
      toast(`Connected to ${host.name}`, 'success');
      renderHosts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Connection failed: ${msg}`, 'danger');
      updateStatus(`Error: ${msg}`);
    }
  }

  async function handleDisconnect(hostId: string): Promise<void> {
    destroyTerminal();
    await disconnectFromHost(hostId);
    placeholder.style.display = '';
    termContainer.style.display = 'none';
    updateStatus('Disconnected');
    renderHosts();
  }

  // --- Terminal ---
  function showTerminal(sessionId: string): void {
    destroyTerminal();
    placeholder.style.display = 'none';
    termContainer.style.display = '';
    termContainer.innerHTML = '';

    activeTerminal = createTerminal(sessionId);
    mountTerminal(activeTerminal, termContainer);
    updateStatus('Connected');
  }

  function destroyTerminal(): void {
    if (activeTerminal) {
      activeTerminal.destroy();
      activeTerminal = null;
    }
  }

  // --- Status bar ---
  function updateStatus(text: string): void {
    const state = pmvpnStore.get();
    statusBar.innerHTML = '';
    statusBar.appendChild(el('span', { cls: 'pmvpn-status-text', text }));
    statusBar.appendChild(el('span', {
      cls: 'pmvpn-status-sessions',
      text: `Sessions: ${state.sessions.size}`,
    }));
  }

  // Subscribe to state changes
  pmvpnStore.subscribe(() => renderHosts());

  // Initial render
  renderHosts();
  updateStatus('Ready');
  termContainer.style.display = 'none';

  return root;
}

// --- Add host form ---
function buildAddHostForm(): HTMLElement {
  const form = el('div', { cls: 'pmvpn-add-host' });

  let nameVal = '';
  let hostVal = '';
  let portVal = '2200';
  let addrVal = '';

  const nameInput = input({
    placeholder: 'Name (e.g. dev-box)',
    cls: 'bp5-input pmvpn-input',
    onInput: (v) => { nameVal = v; },
  });

  const hostInput = input({
    placeholder: 'Host (e.g. 192.168.1.10)',
    cls: 'bp5-input pmvpn-input',
    onInput: (v) => { hostVal = v; },
  });

  const portInput = input({
    placeholder: 'Base port (2200)',
    cls: 'bp5-input pmvpn-input',
    value: '2200',
    onInput: (v) => { portVal = v; },
  });

  const addrInput = input({
    placeholder: 'Wallet address (0x...)',
    cls: 'bp5-input pmvpn-input',
    onInput: (v) => { addrVal = v; },
  });

  const addBtn = btn('Add Host', {
    intent: 'primary',
    onClick: () => {
      if (!nameVal || !hostVal || !addrVal) {
        toast('Fill in all fields', 'warning');
        return;
      }
      pmvpnStore.addHost({
        id: crypto.randomUUID(),
        name: nameVal,
        host: hostVal,
        basePort: parseInt(portVal, 10) || 2200,
        walletAddress: addrVal,
        fingerprint: null,
      });
      nameInput.value = '';
      hostInput.value = '';
      portInput.value = '2200';
      addrInput.value = '';
      nameVal = hostVal = addrVal = '';
      portVal = '2200';
      toast('Host added', 'success');
    },
  });

  form.append(
    el('h4', { text: 'Add Host' }),
    nameInput, hostInput, portInput, addrInput, addBtn,
  );

  return form;
}
