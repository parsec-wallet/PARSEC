// ARIO BASE → Solana migration handler.
//
// We don't replicate sol.ar.io's registration schema (it's a closed dApp
// and its signing payload is undocumented). Instead Parsec orchestrates
// the prep step that sol.ar.io can't:
//   * Reads the user's BASE ARIO balance via MetaMask (eth_call balanceOf)
//   * Surfaces the Solana destination from the active account's chains map
//   * Shows the snapshot countdown (June 1, 2026)
//   * Hands off to sol.ar.io with both addresses copied to clipboard
//
// The user then completes registration on sol.ar.io with their MetaMask
// connected as the source wallet. Parsec stays sovereign over the
// destination Solana key.

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { detectInjectedProvider } from '../lib/builder/isolation';
import { formatArio, MARIO_PER_ARIO } from '../lib/arweave/ario';

const BASE_CHAIN_ID = '0x2105'; // 8453
const BASE_ARIO_CONTRACT = '0x138746adfa52909e5920def027f5a8dc1c7effb6';
const SOLANA_SNAPSHOT = new Date('2026-06-01T00:00:00Z').getTime();
const SOL_AR_IO_URL = 'https://sol.ar.io';

type ProviderRequest = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

interface State {
  evmAddress?: string;
  baseBalanceMicroArio?: bigint;
  solanaAddress?: string;
  error?: string;
}

export function arioMigrateSolanaView(): HTMLElement {
  const state: State = {};
  const root = el('div', { cls: 'parsec-view parsec-confirm' });

  function render(): void {
    root.innerHTML = '';

    root.appendChild(el('div', {
      cls: 'parsec-view__header',
      children: [
        btn('Back', {
          minimal: true,
          icon: 'arrow-left',
          onClick: () => store.navigate('dashboard'),
        }),
        el('h2', { cls: 'parsec-view__title', text: 'ARIO → Solana Migration' }),
      ],
    }));

    // Countdown — most important info on the page.
    const daysLeft = Math.max(0, Math.floor((SOLANA_SNAPSHOT - Date.now()) / 86400000));
    root.appendChild(el('div', {
      cls: daysLeft <= 7
        ? 'parsec-callout bp5-callout bp5-intent-danger'
        : daysLeft <= 30
          ? 'parsec-callout bp5-callout bp5-intent-warning'
          : 'parsec-callout bp5-callout bp5-intent-primary',
      children: [
        el('p', {
          text: `Snapshot: June 1, 2026 — ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining. ARIO on Solana is the canonical token going forward. Register at sol.ar.io before the snapshot or your holding goes into the retroactive claim window.`,
        }),
      ],
    }));

    root.appendChild(buildSourceSection());
    root.appendChild(buildDestinationSection());
    root.appendChild(buildHandoff());

    if (state.error) {
      root.appendChild(el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        children: [el('p', { text: state.error })],
      }));
    }
  }

  // ── Source (BASE / MetaMask) ─────────────────────────────

  function buildSourceSection(): HTMLElement {
    const provider = detectInjectedProvider();
    const evmRow = el('div', { cls: 'parsec-confirm__details' });

    evmRow.appendChild(el('h4', { text: 'Source: BASE ARIO (MetaMask)' }));
    if (!provider) {
      evmRow.appendChild(el('p', {
        text: 'No injected EVM wallet detected. Open Parsec in a browser with MetaMask installed (or run sol.ar.io directly).',
      }));
      return evmRow;
    }
    if (!state.evmAddress) {
      evmRow.appendChild(btn('Connect MetaMask', {
        intent: 'primary',
        onClick: () => void connectEvm(provider.request.bind(provider) as ProviderRequest),
      }));
      return evmRow;
    }

    evmRow.appendChild(row('Connected', truncAddr(state.evmAddress)));
    evmRow.appendChild(row(
      'BASE ARIO',
      state.baseBalanceMicroArio === undefined
        ? 'Reading...'
        : `${formatArio(state.baseBalanceMicroArio)} ARIO`,
    ));
    evmRow.appendChild(btn('Refresh balance', {
      minimal: true,
      onClick: () => void readBaseBalance(provider.request.bind(provider) as ProviderRequest),
    }));
    return evmRow;
  }

  async function connectEvm(request: ProviderRequest): Promise<void> {
    try {
      const accounts = (await request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts || accounts.length === 0) {
        state.error = 'No EVM account approved';
        render();
        return;
      }
      state.evmAddress = accounts[0];

      // Ensure we're on BASE before reading balance.
      const chainId = (await request({ method: 'eth_chainId' })) as string;
      if (chainId !== BASE_CHAIN_ID) {
        try {
          await request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_CHAIN_ID }],
          });
        } catch {
          state.error = 'BASE network switch declined — please switch to BASE in MetaMask and refresh.';
          render();
          return;
        }
      }
      await readBaseBalance(request);
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      render();
    }
  }

  async function readBaseBalance(request: ProviderRequest): Promise<void> {
    if (!state.evmAddress) return;
    try {
      // balanceOf(address) → 0x70a08231 + 32-byte-padded address
      const selector = '0x70a08231';
      const padded = state.evmAddress.slice(2).toLowerCase().padStart(64, '0');
      const data = selector + padded;
      const result = (await request({
        method: 'eth_call',
        params: [{ to: BASE_ARIO_CONTRACT, data }, 'latest'],
      })) as string;
      const microArio = BigInt(result);
      state.baseBalanceMicroArio = microArio;
      render();
    } catch (e) {
      state.error = `Failed to read BASE ARIO balance: ${e instanceof Error ? e.message : String(e)}`;
      render();
    }
  }

  // ── Destination (Solana) ─────────────────────────────────

  function buildDestinationSection(): HTMLElement {
    const dest = el('div', { cls: 'parsec-confirm__details' });
    dest.appendChild(el('h4', { text: 'Destination: Solana (BANKON-held)' }));

    const s = store.get();
    const account = s.accounts[s.activeAccountIndex];
    state.solanaAddress = account ? getAccountAddress(account, 'solana') : undefined;

    if (!state.solanaAddress) {
      dest.appendChild(el('p', { text: 'No Solana address on this account yet.' }));
      dest.appendChild(btn('Create Solana destination', {
        intent: 'primary',
        onClick: () => store.navigate('solana-create'),
      }));
      return dest;
    }

    dest.appendChild(row('Solana address', state.solanaAddress));
    dest.appendChild(btn('Copy', {
      minimal: true,
      icon: 'clipboard',
      onClick: () => {
        void navigator.clipboard.writeText(state.solanaAddress!);
        toast('Solana address copied', 'success');
      },
    }));
    return dest;
  }

  // ── Handoff to sol.ar.io ─────────────────────────────────

  function buildHandoff(): HTMLElement {
    const ready = state.evmAddress && state.solanaAddress &&
      (state.baseBalanceMicroArio ?? 0n) > 0n;
    return el('div', {
      children: [
        el('p', {
          cls: 'parsec-view__desc',
          text: 'Final step: open sol.ar.io, connect the same MetaMask (BASE) as the source wallet, paste the Solana address above as the destination, and sign the registration. sol.ar.io is the canonical AR.IO registration site.',
        }),
        ready && state.baseBalanceMicroArio !== undefined && state.baseBalanceMicroArio < MARIO_PER_ARIO
          ? el('div', {
              cls: 'parsec-callout bp5-callout bp5-intent-warning',
              children: [el('p', { text: 'Your BASE ARIO balance is below 1 ARIO. Verify the right BASE address is connected.' })],
            })
          : el('span', {}),
        el('div', {
          cls: 'parsec-confirm__actions',
          children: [
            btn('Back', {
              outlined: true,
              large: true,
              onClick: () => store.navigate('dashboard'),
            }),
            el('a', {
              attrs: {
                href: SOL_AR_IO_URL,
                target: '_blank',
                rel: 'noopener',
                class: 'bp5-button bp5-intent-primary bp5-large',
              },
              text: 'Open sol.ar.io →',
            }),
          ],
        }),
      ],
    });
  }

  render();
  return root;
}

function row(label: string, value: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [
      el('span', { cls: 'parsec-confirm__label', text: label }),
      el('span', { cls: 'parsec-confirm__value', text: value }),
    ],
  });
}

function truncAddr(a: string): string {
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}
