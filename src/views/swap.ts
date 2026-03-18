// Parsec Wallet — SpinTrade Swap View
// Parsec facilitates secure DEX interaction. Participant chooses the DEX.
// "To" field pulls real tradeable assets from on-chain pools at zero cost.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { microAlgosToAlgo } from '../lib/algorand/account';
import { formatAssetAmount, DEFAULT_DECIMALS } from '../lib/algorand/assets';
import { getSwapQuote, executeSwap, fetchPoolsForAsset } from '../lib/algorand/swap';
import type { SwapQuote, SwapableAsset } from '../lib/algorand/swap';
import { keystoreRetrieve } from '../lib/keystore';

export function swapView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return el('div'); }
  if (account.watchOnly) {
    return el('div', {
      cls: 'parsec-view',
      children: [
        el('div', { cls: 'parsec-view__header', children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Swap' }),
        ]}),
        el('div', { cls: 'parsec-empty', text: 'Watch-only accounts cannot swap.' }),
      ],
    });
  }

  const info = state.accountInfo;

  // "From" assets = what the participant holds
  const heldAssets = [
    { assetId: 0, unitName: 'ALGO', name: 'Algorand', decimals: 6, amount: info?.amount || 0 },
    ...(info?.assets || []).filter(a => !a.isFrozen).map(a => ({
      assetId: a.assetId,
      unitName: a.unitName || `ASA#${a.assetId}`,
      name: a.name || a.unitName || `ASA #${a.assetId}`,
      decimals: a.decimals ?? DEFAULT_DECIMALS,
      amount: a.amount,
    })),
  ];

  let selectedFromIdx = 0;
  let selectedToAsset: SwapableAsset | null = null;
  let inputAmount = '';
  let currentQuote: SwapQuote | null = null;

  const quoteContainer = el('div', { cls: 'parsec-swap__quote' });
  const toSelectContainer = el('div', { cls: 'parsec-swap__to-container' });

  // "From" select — participant's holdings
  const fromSelect = document.createElement('select');
  fromSelect.className = 'bp5-input parsec-settings__select';
  heldAssets.forEach((a, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    const bal = a.assetId === 0 ? microAlgosToAlgo(a.amount) : formatAssetAmount(a.amount, a.decimals);
    opt.textContent = `${a.unitName} (${bal})`;
    opt.selected = i === 0;
    fromSelect.appendChild(opt);
  });
  fromSelect.addEventListener('change', () => {
    selectedFromIdx = parseInt(fromSelect.value, 10);
    selectedToAsset = null;
    currentQuote = null;
    quoteContainer.innerHTML = '';
    loadOutputAssets();
  });

  // Load available output assets from Tinyman pools
  async function loadOutputAssets() {
    const fromAsset = heldAssets[selectedFromIdx];
    toSelectContainer.innerHTML = '';
    toSelectContainer.appendChild(el('div', { cls: 'parsec-swap__loading', text: 'Loading tradeable assets...' }));

    const poolAssets = await fetchPoolsForAsset(fromAsset.assetId, state.settings.network);

    toSelectContainer.innerHTML = '';
    if (poolAssets.length === 0) {
      toSelectContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'No liquidity pools found for this asset.' }));
      return;
    }

    const toSelect = document.createElement('select');
    toSelect.className = 'bp5-input parsec-settings__select';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = `Select asset (${poolAssets.length} available)`;
    placeholder.selected = true;
    placeholder.disabled = true;
    toSelect.appendChild(placeholder);

    poolAssets.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = String(a.assetId);
      opt.textContent = `${a.unitName || a.name} (ID: ${a.assetId})`;
      toSelect.appendChild(opt);
    });

    toSelect.addEventListener('change', () => {
      const id = parseInt(toSelect.value, 10);
      selectedToAsset = poolAssets.find(a => a.assetId === id) || null;
      currentQuote = null;
      quoteContainer.innerHTML = '';
    });

    toSelectContainer.appendChild(toSelect);
  }

  const amountInput = input({
    type: 'number',
    placeholder: 'Amount',
    cls: 'bp5-input bp5-large bp5-fill',
    onInput: (v) => { inputAmount = v; },
  });

  async function fetchQuote() {
    const parsed = parseFloat(inputAmount);
    if (isNaN(parsed) || parsed <= 0) { toast('Enter an amount', 'danger'); return; }
    if (!selectedToAsset) { toast('Select an asset to receive', 'danger'); return; }

    const fromAsset = heldAssets[selectedFromIdx];
    if (fromAsset.assetId === selectedToAsset.assetId) { toast('Cannot swap to same asset', 'danger'); return; }

    const baseAmount = Math.round(parsed * Math.pow(10, fromAsset.decimals));

    quoteContainer.innerHTML = '';
    quoteContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'Fetching quote...' }));

    const quote = await getSwapQuote(
      fromAsset.assetId, selectedToAsset.assetId, baseAmount, 50, state.settings.network
    );

    quoteContainer.innerHTML = '';
    if (!quote) {
      quoteContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'No pool found for this pair. Try swapping through ALGO.' }));
      currentQuote = null;
      return;
    }

    currentQuote = quote;
    const outDisplay = formatAssetAmount(quote.outputAmount, selectedToAsset.decimals);
    const minDisplay = formatAssetAmount(quote.minOutput, selectedToAsset.decimals);

    quoteContainer.appendChild(el('div', {
      cls: 'parsec-confirm__details',
      children: [
        row('You Send', `${parsed} ${fromAsset.unitName}`),
        row('You Receive', `~${outDisplay} ${selectedToAsset.unitName}`),
        row('Rate', `1 ${fromAsset.unitName} = ${quote.exchangeRate.toFixed(6)} ${selectedToAsset.unitName}`),
        row('Min Received', `${minDisplay} ${selectedToAsset.unitName}`),
        row('Price Impact', `${quote.priceImpact.toFixed(2)}%`),
        row('Slippage', '0.5%'),
        row('Pool Fee', '0.3%'),
        row('DEX', 'Tinyman v2'),
      ],
    }));

    quoteContainer.appendChild(
      btn('Confirm Swap', {
        intent: 'primary', large: true, cls: 'parsec-send__submit',
        onClick: doSwap,
      })
    );
  }

  async function doSwap() {
    if (!currentQuote || !selectedToAsset) return;
    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Session expired.', 'danger'); store.navigate('unlock'); return; }

    let mnemonic: string | null = await keystoreRetrieve(account.address, passphrase);
    if (!mnemonic) { toast('Could not retrieve key.', 'danger'); return; }

    store.set({ isLoading: true });
    try {
      const { txId } = await executeSwap(
        mnemonic,
        currentQuote.inputAssetId,
        currentQuote.outputAssetId,
        currentQuote.inputAmount,
        currentQuote.minOutput,
        currentQuote.poolAddress,
        state.settings.network,
      );
      store.set({ isLoading: false, accountInfo: null });
      toast(`Swap complete! TX: ${txId.slice(0, 12)}...`, 'success');
      store.navigate('dashboard');
    } catch (err) {
      store.set({ isLoading: false });
      toast(err instanceof Error ? err.message : 'Swap failed', 'danger');
    } finally {
      if (mnemonic) mnemonic = '\0'.repeat(mnemonic.length);
      mnemonic = null;
    }
  }

  // Initial load of output assets
  loadOutputAssets();

  return el('div', {
    cls: 'parsec-view parsec-swap',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Swap' }),
        ],
      }),
      el('p', { cls: 'parsec-view__desc', text: 'Trade assets via Tinyman v2 liquidity pools.' }),
      el('div', {
        cls: 'parsec-swap__form',
        children: [
          el('label', { cls: 'parsec-label', text: 'From (your holdings)' }),
          fromSelect,
          amountInput,
          el('label', { cls: 'parsec-label', text: 'To (available pools)' }),
          toSelectContainer,
        ],
      }),
      btn('Get Quote', { intent: 'primary', large: true, cls: 'parsec-send__submit', onClick: fetchQuote }),
      quoteContainer,
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
