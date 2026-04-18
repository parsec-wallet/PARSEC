// Parsec Wallet — Confirm Send View
// Shows transaction details before signing. User reviews and confirms.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { microAlgosToAlgo } from '../lib/algorand/account';
import { formatAssetAmount } from '../lib/algorand/assets';
import { sendPayment, sendAssetTransfer, isValidAddress } from '../lib/algorand/transactions';
import { keystoreRetrieve } from '../lib/keystore';
import { getAlgodClient } from '../lib/algorand/client';

export function confirmSendView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const pending = store.getPendingSend();

  if (!account || !pending) { store.navigate('dashboard'); return el('div'); }

  // M1: Re-validate receiver address before displaying confirmation
  if (!isValidAddress(pending.receiver)) {
    toast('Invalid receiver address detected', 'danger');
    store.navigate('send');
    return el('div');
  }

  const isAlgo = pending.assetId === null;
  const displayAmount = isAlgo
    ? microAlgosToAlgo(pending.amount)
    : formatAssetAmount(pending.amount, pending.assetDecimals);

  const truncAddr = (a: string) => `${a.slice(0, 8)}...${a.slice(-6)}`;

  return el('div', {
    cls: 'parsec-view parsec-confirm',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Cancel', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('send') }),
          el('h2', { cls: 'parsec-view__title', text: 'Confirm Transaction' }),
        ],
      }),

      el('div', {
        cls: 'parsec-confirm__details',
        children: [
          row('From', truncAddr(account.address)),
          row('To', truncAddr(pending.receiver)),
          row('Amount', `${displayAmount} ${pending.assetUnitName}`),
          row('Network Fee', `${microAlgosToAlgo(pending.fee, 4)} ALGO`),
          isAlgo ? row('Total', `${microAlgosToAlgo(pending.amount + pending.fee)} ALGO`) : null,
          pending.note ? row('Note', pending.note) : null,
          row('Network', state.settings.network.toUpperCase()),
        ].filter(Boolean) as HTMLElement[],
      }),

      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        children: [el('p', { text: 'Verify all details. Transactions on Algorand are irreversible.' })],
      }),

      el('div', {
        cls: 'parsec-confirm__actions',
        children: [
          btn('Cancel', {
            large: true, outlined: true,
            onClick: () => store.navigate('send'),
          }),
          btn('Sign & Send', {
            intent: 'primary', large: true,
            onClick: async () => {
              const passphrase = store.getPassphrase();
              if (!passphrase) { toast('Session expired.', 'danger'); store.navigate('unlock'); return; }

              store.set({ isLoading: true });
              let mnemonic: string | null = null;
              try {
                // M2: Re-fetch fee from chain before signing (may have changed since review)
                const currentParams = await getAlgodClient(state.settings.network).getTransactionParams().do();
                const currentFee = Math.max(Number(currentParams.fee) || 1000, 1000);
                if (currentFee > pending.fee * 2) {
                  store.set({ isLoading: false });
                  toast(`Network fee increased significantly (${microAlgosToAlgo(currentFee, 4)} ALGO). Please re-submit.`, 'warning');
                  store.navigate('send');
                  return;
                }

                mnemonic = await keystoreRetrieve(account.address, passphrase);
                if (!mnemonic) { toast('Could not retrieve key. Re-unlock.', 'danger'); store.set({ isLoading: false }); store.navigate('unlock'); return; }

                let txId: string;
                if (isAlgo) {
                  const result = await sendPayment(mnemonic, pending.receiver, pending.amount, pending.note, state.settings.network);
                  txId = result.txId;
                } else {
                  const result = await sendAssetTransfer(mnemonic, pending.receiver, pending.amount, pending.assetId!, pending.note, state.settings.network);
                  txId = result.txId;
                }

                store.set({ isLoading: false, accountInfo: null });
                store.setPendingSend(null);
                toast(`Sent! TX: ${txId.slice(0, 12)}...`, 'success');
                store.navigate('dashboard');
              } catch (err) {
                store.set({ isLoading: false });
                toast(err instanceof Error ? err.message : 'Transaction failed', 'danger');
              } finally {
                if (mnemonic) mnemonic = '\0'.repeat(mnemonic.length);
                mnemonic = null;
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
