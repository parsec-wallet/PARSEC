// ARIO migration failsafe — a Parsec-native flow that constructs and signs
// the ARIO migration message itself, independent of sol.ar.io's frontend.
//
// Built on the same primitives as the injected API (signDataItem + aoMessage),
// so it costs almost nothing beyond a tiny view. The dApp route through
// window.arweaveWallet is the durable answer; this is the "what if sol.ar.io
// goes down on migration day" backup.
//
// Configure the ARIO process id in localStorage under `parsec:ario-process-id`
// before use, or set it inline via the input field on the page.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { aoMessage, buildAoMessageInput } from '../lib/arweave/ao';
import { signDataItemFromVault } from '../lib/arweave/ans104';

const PROCESS_ID_KEY = 'parsec:ario-process-id';

function loadProcessId(): string {
  try {
    return localStorage.getItem(PROCESS_ID_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveProcessId(id: string): void {
  try {
    localStorage.setItem(PROCESS_ID_KEY, id);
  } catch { /* */ }
}

export function arweaveArioMigrateView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const address = account
    ? (getAccountAddress(account, 'arweave') ?? getAccountAddress(account, 'arweave-hd'))
    : undefined;

  let processId = loadProcessId();
  let action = 'Migrate';

  const processInput = input({
    placeholder: 'ARIO process id (43-char base64url)',
    cls: 'bp5-input bp5-fill',
    value: processId,
    onInput: (v) => { processId = v.trim(); },
  });

  const actionInput = input({
    placeholder: 'Action (default: Migrate)',
    cls: 'bp5-input bp5-fill',
    value: action,
    onInput: (v) => { action = v.trim() || 'Migrate'; },
  });

  const statusBox = el('pre', {
    cls: 'parsec-confirm__details',
    attrs: { style: 'white-space: pre-wrap; min-height: 60px;' },
    text: '',
  });

  function setStatus(msg: string): void {
    statusBox.textContent = msg;
  }

  return el('div', {
    cls: 'parsec-view parsec-confirm',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', {
            minimal: true,
            icon: 'arrow-left',
            onClick: () => store.navigate('dashboard'),
          }),
          el('h2', { cls: 'parsec-view__title', text: 'ARIO Migration (Direct)' }),
        ],
      }),

      el('p', {
        cls: 'parsec-view__desc',
        text: 'Construct and submit the ARIO migration message directly from Parsec — independent of any web frontend. The Arweave key never leaves the BANKON vault.',
      }),

      el('div', {
        cls: 'parsec-confirm__details',
        children: [
          row('Signing As', address ? truncAddr(address) : 'No Arweave account'),
          divider(),
          el('label', { text: 'ARIO Process ID' }),
          processInput,
          el('label', { text: 'Action Tag' }),
          actionInput,
        ],
      }),

      statusBox,

      el('div', {
        cls: 'parsec-confirm__actions',
        children: [
          btn('Cancel', {
            outlined: true,
            large: true,
            onClick: () => store.navigate('dashboard'),
          }),
          btn('Sign & Submit', {
            intent: 'primary',
            large: true,
            disabled: !address,
            onClick: async () => {
              if (!address) {
                toast('No Arweave account', 'danger');
                return;
              }
              if (!processId || processId.length < 8) {
                toast('Enter a valid ARIO process id', 'warning');
                return;
              }
              const passphrase = store.getPassphrase();
              if (!passphrase) {
                toast('Wallet is locked', 'danger');
                store.navigate('unlock');
                return;
              }
              saveProcessId(processId);
              store.set({ isLoading: true });
              setStatus('Building DataItem...');
              try {
                const baseInput = buildAoMessageInput({
                  process: processId,
                  tags: [{ name: 'Action', value: action }],
                });
                setStatus('Signing with vault-held JWK...');
                const signed = await signDataItemFromVault(address, passphrase, baseInput);
                setStatus(`Submitting to AO MU (id=${signed.id})...`);
                const result = await aoMessage(signed);
                setStatus(`Submitted. Message id: ${result.id}\nKeep this id to query results later.`);
                toast('ARIO migration message submitted', 'success');
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setStatus(`Failed: ${msg}`);
                toast(`Submission failed: ${msg}`, 'danger');
              } finally {
                store.set({ isLoading: false });
              }
            },
          }),
        ],
      }),
    ],
  });
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

function divider(): HTMLElement {
  return el('hr', { cls: 'parsec-confirm__divider' });
}

function truncAddr(a: string): string {
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}
