// Parsec Wallet — Send View
// Supports ALGO + any opted-in ASA. Navigates to confirm-send before signing.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { isValidAddress } from '../lib/algorand/transactions';
import { microAlgosToAlgo } from '../lib/algorand/account';
import { formatAssetAmount, DEFAULT_DECIMALS } from '../lib/algorand/assets';
import { getAlgodClient } from '../lib/algorand/client';
import type { PendingSend } from '../types/wallet';

export function sendView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return el('div'); }

  // Watch-only accounts cannot send
  if (account.watchOnly) {
    return el('div', {
      cls: 'parsec-view parsec-send',
      children: [
        el('div', {
          cls: 'parsec-view__header',
          children: [
            btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
            el('h2', { cls: 'parsec-view__title', text: 'Send' }),
          ],
        }),
        el('div', { cls: 'parsec-empty', text: 'Watch-only accounts cannot send transactions. Import your recovery phrase or private key to enable signing.' }),
      ],
    });
  }

  let receiver = '', amount = '', note = '';
  let selectedAssetId: number | null = null; // null = ALGO
  let selectedDecimals = 6;
  let selectedUnitName = 'ALGO';

  // Asset selector — ALGO + opted-in ASAs
  const assetSelect = document.createElement('select');
  assetSelect.className = 'bp5-input parsec-settings__select';

  const algoOpt = document.createElement('option');
  algoOpt.value = 'algo';
  algoOpt.textContent = `ALGO (${state.accountInfo ? microAlgosToAlgo(state.accountInfo.amount) : '...'})`;
  assetSelect.appendChild(algoOpt);

  if (state.accountInfo) {
    for (const asset of state.accountInfo.assets) {
      if (asset.isFrozen) continue; // Can't send frozen assets
      const opt = document.createElement('option');
      opt.value = String(asset.assetId);
      const dec = asset.decimals ?? DEFAULT_DECIMALS;
      opt.textContent = `${asset.unitName || `ASA #${asset.assetId}`} (${formatAssetAmount(asset.amount, dec)})`;
      assetSelect.appendChild(opt);
    }
  }

  assetSelect.addEventListener('change', () => {
    if (assetSelect.value === 'algo') {
      selectedAssetId = null;
      selectedDecimals = 6;
      selectedUnitName = 'ALGO';
    } else {
      selectedAssetId = parseInt(assetSelect.value, 10);
      const asset = state.accountInfo?.assets.find(a => a.assetId === selectedAssetId);
      selectedDecimals = asset?.decimals ?? DEFAULT_DECIMALS;
      selectedUnitName = asset?.unitName || `ASA #${selectedAssetId}`;
    }
  });

  const noteBytes = el('span', { cls: 'parsec-send__note-count', text: '0/1000 bytes' });

  return el('div', {
    cls: 'parsec-view parsec-send',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Send' }),
        ],
      }),
      el('div', {
        cls: 'parsec-send__form',
        children: [
          el('label', { cls: 'parsec-label', text: 'Asset' }),
          assetSelect,
          el('label', { cls: 'parsec-label', text: 'To' }),
          input({
            placeholder: 'Recipient address (58 characters)',
            cls: 'bp5-input bp5-large bp5-fill parsec-send__input',
            onInput: (v) => { receiver = v; },
          }),
          el('label', { cls: 'parsec-label', text: 'Amount' }),
          input({
            type: 'number',
            placeholder: `Amount (${selectedUnitName})`,
            cls: 'bp5-input bp5-large bp5-fill parsec-send__input',
            onInput: (v) => { amount = v; },
          }),
          el('label', { cls: 'parsec-label', text: 'Note (optional)' }),
          input({
            placeholder: 'Transaction note',
            cls: 'bp5-input bp5-fill parsec-send__input',
            onInput: (v) => {
              note = v;
              const bytes = new TextEncoder().encode(v).length;
              noteBytes.textContent = `${bytes}/1000 bytes`;
              noteBytes.className = `parsec-send__note-count${bytes > 1000 ? ' parsec-send__note-count--over' : ''}`;
            },
          }),
          noteBytes,
        ],
      }),
      btn('Review Transaction', {
        intent: 'primary', large: true, cls: 'parsec-send__submit',
        onClick: async () => {
          if (!isValidAddress(receiver)) { toast('Invalid recipient address', 'danger'); return; }
          if (receiver === account.address) { toast('Cannot send to yourself', 'warning'); return; }
          const parsed = parseFloat(amount);
          if (isNaN(parsed) || parsed <= 0) { toast('Enter a valid amount', 'danger'); return; }
          const noteByteLen = new TextEncoder().encode(note).length;
          if (noteByteLen > 1000) { toast('Note exceeds 1000 bytes', 'danger'); return; }

          if (!store.getPassphrase()) { toast('Session expired. Please unlock.', 'danger'); store.navigate('unlock'); return; }

          // Fetch fee
          try {
            const client = getAlgodClient(state.settings.network);
            const params = await client.getTransactionParams().do();
            const fee = Math.max(Number(params.fee) || 1000, 1000);

            // Convert amount to base units
            let baseAmount: number;
            if (selectedAssetId === null) {
              baseAmount = Math.round(parsed * 1_000_000);
            } else {
              baseAmount = Math.round(parsed * Math.pow(10, selectedDecimals));
            }

            // M4: Balance check — prevent sending more than available
            if (state.accountInfo) {
              if (selectedAssetId === null) {
                // ALGO: must keep min balance (0.1 ALGO = 100000 microAlgos) + fee
                const available = state.accountInfo.amount - state.accountInfo.minBalance - fee;
                if (baseAmount > available) {
                  toast(`Insufficient ALGO. Available: ${microAlgosToAlgo(Math.max(0, available))} (${microAlgosToAlgo(state.accountInfo.minBalance)} reserved)`, 'danger');
                  return;
                }
              } else {
                // ASA: check asset balance
                const asset = state.accountInfo.assets.find(a => a.assetId === selectedAssetId);
                if (!asset || asset.amount < baseAmount) {
                  toast(`Insufficient ${selectedUnitName} balance`, 'danger');
                  return;
                }
                // Also check ALGO for fee
                const algoAvailable = state.accountInfo.amount - state.accountInfo.minBalance - fee;
                if (algoAvailable < 0) {
                  toast(`Insufficient ALGO for transaction fee (need ${microAlgosToAlgo(fee)})`, 'danger');
                  return;
                }
              }
            }

            const pending: PendingSend = {
              receiver,
              amount: baseAmount,
              assetId: selectedAssetId,
              assetUnitName: selectedUnitName,
              assetDecimals: selectedDecimals,
              note,
              fee,
            };
            store.setPendingSend(pending);
            store.navigate('confirm-send');
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to fetch fee', 'danger');
          }
        },
      }),
    ],
  });
}
