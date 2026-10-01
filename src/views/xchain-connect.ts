// Connect MetaMask → derive the controlled Algorand LogicSig address →
// register it as a watch-only-from-parsec / fully-spendable-via-MetaMask account.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { detectInjectedProvider } from '../lib/builder/isolation';
import { deriveAlgorandFromEvm } from '../lib/xchain/account';
import { vaultStoreKey } from '../lib/vault';

export function xchainConnectView(): HTMLElement {
  const evmList = el('div', { cls: 'parsec-xchain__evm-list' });
  const status = el('div', { cls: 'parsec-xchain__status', text: '' });
  const previewBox = el('div', { cls: 'parsec-xchain__preview' });
  let chosenEvm: string | null = null;
  let derivedAlgo: string | null = null;

  async function refreshAccounts(): Promise<void> {
    evmList.innerHTML = '';
    const provider = detectInjectedProvider();
    if (!provider) {
      status.textContent = 'No injected EVM wallet detected. Install MetaMask, Rabby, or another EIP-1193 provider.';
      return;
    }

    let accounts: string[] = [];
    try {
      accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Failed to request accounts';
      return;
    }
    if (!accounts.length) {
      status.textContent = 'MetaMask is connected but reports no accounts.';
      return;
    }

    status.textContent = `Found ${accounts.length} EVM account${accounts.length === 1 ? '' : 's'}. Pick one to derive its Algorand LogicSig address.`;

    for (const evm of accounts) {
      const row = el('button', {
        cls: 'parsec-xchain__evm-row bp5-button bp5-minimal',
        text: evm,
        onClick: async () => {
          chosenEvm = evm;
          previewBox.innerHTML = '';
          previewBox.appendChild(el('div', { text: 'Deriving…', cls: 'parsec-xchain__deriving' }));
          try {
            derivedAlgo = await deriveAlgorandFromEvm(evm, store.get().settings.network);
            previewBox.innerHTML = '';
            previewBox.append(
              el('div', { cls: 'parsec-xchain__pair-label', text: 'EVM controller' }),
              el('div', { cls: 'parsec-xchain__pair-value', text: evm }),
              el('div', { cls: 'parsec-xchain__pair-label', text: 'Controlled Algorand LogicSig address' }),
              el('div', { cls: 'parsec-xchain__pair-value', text: derivedAlgo }),
            );
          } catch (err) {
            previewBox.innerHTML = '';
            previewBox.appendChild(el('div', {
              cls: 'parsec-xchain__error',
              text: err instanceof Error ? err.message : 'Derivation failed',
            }));
            derivedAlgo = null;
          }
        },
      });
      evmList.appendChild(row);
    }
  }

  async function confirm(): Promise<void> {
    if (!chosenEvm || !derivedAlgo) {
      toast('Pick an EVM account first', 'warning');
      return;
    }
    try {
      await vaultStoreKey(derivedAlgo, 'algorand-xchain', `xchain ${chosenEvm.slice(0, 8)}…${chosenEvm.slice(-4)}`, chosenEvm);
      toast('xchain account linked. MetaMask remains the signer.', 'success');
      store.navigate('dashboard');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to register xchain account', 'danger');
    }
  }

  // Kick off detection on mount.
  setTimeout(() => { void refreshAccounts(); }, 100);

  return el('div', {
    cls: 'parsec-view parsec-xchain',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('onboarding') }),
          el('h2', { cls: 'parsec-view__title', text: 'Connect EVM Wallet (xchain)' }),
        ],
      }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'Your EVM key (e.g. MetaMask) controls a deterministic Algorand LogicSig address on-chain. PARSEC never holds the key — MetaMask remains the sole custodian. Each EVM address maps to exactly one Algorand address.',
      }),
      status,
      evmList,
      previewBox,
      btn('Link this account', {
        intent: 'primary', large: true, icon: 'link',
        onClick: () => { void confirm(); },
      }),
    ],
  });
}
