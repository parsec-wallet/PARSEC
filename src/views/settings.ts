// Parsec Wallet — Settings View

import { isTauri } from '../lib/platform';
import { getAutostart, getCloseToTray, setAutostart, setCloseToTray } from '../lib/app-shell';
import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { ACCOUNT_AVATARS, defaultAvatarFor } from '../lib/avatars';
import type { NetworkId, WalletAccount } from '../types/wallet';

export function settingsView(): HTMLElement {
  const state = store.get();

  // Phantom-style account row: emoji avatar (with inline picker), inline
  // rename, address, and the switch/active control.
  function accountRow(acct: WalletAccount, i: number): HTMLElement {
    const avatarBtn = el('button', {
      cls: 'bp5-button bp5-minimal parsec-settings__avatar',
      text: acct.avatar ?? defaultAvatarFor(acct.address),
    });
    const nameSpan = el('span', { cls: 'parsec-settings__account-name', text: acct.name });
    const picker = el('div', { cls: 'parsec-settings__avatar-picker' });

    function persist(mut: (a: WalletAccount) => WalletAccount): void {
      const s = store.get();
      store.set({ accounts: s.accounts.map((a, idx) => (idx === i ? mut(a) : a)) });
    }

    for (const emoji of ACCOUNT_AVATARS) {
      picker.appendChild(el('button', {
        cls: 'bp5-button bp5-minimal parsec-settings__avatar-option',
        text: emoji,
        onClick: () => {
          persist((a) => ({ ...a, avatar: emoji }));
          avatarBtn.textContent = emoji;
          picker.classList.remove('parsec-settings__avatar-picker--open');
        },
      }));
    }
    avatarBtn.addEventListener('click', () => {
      picker.classList.toggle('parsec-settings__avatar-picker--open');
    });

    const row = el('div', {
      cls: `parsec-settings__account ${i === state.activeAccountIndex ? 'parsec-settings__account--active' : ''}`,
      children: [
        avatarBtn,
        nameSpan,
        el('span', { cls: 'parsec-settings__account-addr', text: `${acct.address.slice(0, 8)}...${acct.address.slice(-4)}` }),
        btn('Rename', {
          minimal: true, icon: 'edit',
          onClick: () => {
            const next = prompt('Account name', acct.name);
            if (next && next.trim()) {
              const name = next.trim();
              persist((a) => ({ ...a, name }));
              nameSpan.textContent = name;
            }
          },
        }),
        i !== state.activeAccountIndex
          ? btn('Switch', { minimal: true, onClick: () => { store.set({ activeAccountIndex: i, accountInfo: null, transactions: [] }); store.navigate('dashboard'); } })
          : el('span', { cls: 'parsec-badge', text: 'Active' }),
      ],
    });
    return el('div', { cls: 'parsec-settings__account-wrap', children: [row, picker] });
  }

  // Diagnostics — a strong on/off shield toggle. Off by default; the
  // "Open Diagnostics" entry appears only while it is on. Persists at once.
  function buildDiagnosticsSection(): HTMLElement {
    const section = el('div', { cls: 'parsec-settings__section' });
    function render(): void {
      section.innerHTML = '';
      const on = store.get().settings.enableDiagnostics === true;
      const shield = el('button', {
        cls: `parsec-diag__shield ${on ? 'parsec-diag__shield--on' : ''}`,
        attrs: { type: 'button', title: 'Toggle the Diagnostics screen' },
        children: [
          el('span', { cls: 'parsec-diag__shield-glyph', text: '\u{1F6E1}' }),
          el('span', { cls: 'parsec-diag__shield-label', text: 'Diagnostics' }),
          el('span', { cls: 'parsec-diag__shield-state', text: on ? 'ON' : 'OFF' }),
        ],
      });
      shield.addEventListener('click', () => {
        const s = store.get();
        store.set({ settings: { ...s.settings, enableDiagnostics: !on } });
        toast(`Diagnostics ${!on ? 'enabled' : 'disabled'}`, 'success');
        render();
      });
      const children: HTMLElement[] = [
        el('h3', { cls: 'parsec-section-title', text: 'Diagnostics' }),
        el('p', { cls: 'parsec-view__desc', text: 'An optional, no-storage screen for live network, CPU/GPU and service-reachability readings. Off by default.' }),
        shield,
      ];
      if (on) {
        children.push(btn('Open Diagnostics', { outlined: true, icon: 'pulse', onClick: () => store.navigate('diagnostics') }));
      }
      section.append(...children);
    }
    render();
    return section;
  }

  const networkSelect = document.createElement('select');
  networkSelect.className = 'bp5-input parsec-settings__select';
  for (const net of ['mainnet', 'testnet', 'betanet'] as NetworkId[]) {
    const opt = document.createElement('option');
    opt.value = net;
    opt.textContent = net.charAt(0).toUpperCase() + net.slice(1);
    opt.selected = net === state.settings.network;
    networkSelect.appendChild(opt);
  }

  return el('div', {
    cls: 'parsec-view parsec-settings',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Settings' }),
        ],
      }),
      el('div', { cls: 'parsec-settings__section', children: [
        el('label', { cls: 'parsec-label', text: 'Network' }),
        networkSelect,
      ]}),
      el('div', { cls: 'parsec-settings__section', children: [
        el('h3', { cls: 'parsec-section-title', text: 'Accounts' }),
        ...state.accounts.map((acct, i) => accountRow(acct, i)),
      ]}),
      el('div', { cls: 'parsec-settings__section', children: [
        btn('Create New Account', { outlined: true, icon: 'plus', onClick: () => store.navigate('create-wallet') }),
        btn('Import Account', { outlined: true, icon: 'import', onClick: () => store.navigate('import-wallet') }),
      ]}),
      btn('Save Settings', {
        intent: 'primary',
        onClick: () => {
          const newNetwork = networkSelect.value as NetworkId;
          const changed = newNetwork !== state.settings.network;
          store.set({ settings: { ...state.settings, network: newNetwork }, ...(changed ? { accountInfo: null, transactions: [] } : {}) });
          toast('Settings saved', 'success');
          store.navigate('dashboard');
        },
      }),
      ...(isTauri ? [buildWindowSection()] : []),
      el('div', { cls: 'parsec-settings__section', children: [
        el('h3', { cls: 'parsec-section-title', text: 'Security & Vault' }),
        btn('Mausoleum', { outlined: true, icon: 'shield', onClick: () => store.navigate('mausoleum') }),
        btn('Admin Key Ceremony', { outlined: true, icon: 'key', onClick: () => store.navigate('admin-keygen') }),
      ]}),
      buildDiagnosticsSection(),
      el('div', { cls: 'parsec-settings__section', children: [
        btn('Lock Wallet', { outlined: true, icon: 'lock', onClick: () => {
          // Locking an armed wallet is the complete logout (lib/session.ts).
          void import('../lib/session').then((m) => m.logout()).then(() => toast('Wallet locked and logged out', 'success'));
        } }),
      ]}),
      el('div', { cls: 'parsec-settings__danger', children: [
        el('h3', { cls: 'parsec-section-title', text: 'Danger Zone' }),
        el('p', { cls: 'parsec-view__desc', text: 'Permanently removes all accounts and keys from this device. You need your recovery phrase to restore.' }),
        btn('Reset Wallet', { intent: 'danger', outlined: true, onClick: () => {
          if (confirm('Delete ALL accounts and keys? Make sure you have your recovery phrase.')) { store.reset(); toast('Wallet reset', 'warning'); }
        }}),
      ]}),
    ],
  });
}

/** Desktop only: what closing the window does, and whether Parsec starts at login. */
function buildWindowSection(): HTMLElement {
  const status = el('p', { cls: 'parsec-view__desc', attrs: { 'aria-live': 'polite' } });

  const trayBox = el('input', { attrs: { type: 'checkbox', id: 'parsec-close-to-tray' } }) as HTMLInputElement;
  trayBox.checked = getCloseToTray();
  trayBox.addEventListener('change', () => {
    void setCloseToTray(trayBox.checked).then(() => {
      status.textContent = trayBox.checked
        ? 'Closing the window keeps Parsec running in the tray. Quit from the tray menu.'
        : 'Closing the window quits Parsec.';
    });
  });

  const bootBox = el('input', { attrs: { type: 'checkbox', id: 'parsec-autostart' } }) as HTMLInputElement;
  bootBox.disabled = true;
  void getAutostart().then((on) => { bootBox.checked = on; bootBox.disabled = false; }).catch(() => {
    status.textContent = 'Start at login is not available here.';
  });
  bootBox.addEventListener('change', () => {
    bootBox.disabled = true;
    void setAutostart(bootBox.checked)
      .then((on) => {
        bootBox.checked = on;
        status.textContent = on ? 'Parsec starts at login, in the tray.' : 'Parsec no longer starts at login.';
      })
      .catch((e) => {
        bootBox.checked = !bootBox.checked;
        status.textContent = `Could not change start at login: ${e instanceof Error ? e.message : String(e)}`;
      })
      .finally(() => { bootBox.disabled = false; });
  });

  const row = (box: HTMLInputElement, label: string, hint: string) => el('label', {
    cls: 'bp5-control bp5-switch parsec-settings__switch',
    attrs: { for: box.id },
    children: [box, el('span', { cls: 'bp5-control-indicator' }), el('span', { text: label }), el('small', { cls: 'parsec-view__desc', text: ` — ${hint}` })],
  });

  return el('div', { cls: 'parsec-settings__section', children: [
    el('h3', { cls: 'parsec-section-title', text: 'Window' }),
    row(trayBox, 'Close to tray', 'closing the window keeps Parsec running; the tray icon brings it back'),
    row(bootBox, 'Start at login', 'opens in the tray when you sign in to this computer'),
    status,
  ]});
}
