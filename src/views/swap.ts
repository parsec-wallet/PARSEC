// Parsec Wallet — SpinTrade Swap View

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { microAlgosToAlgo } from '../lib/algorand/account';
import { formatAssetAmount, DEFAULT_DECIMALS } from '../lib/algorand/assets';
import { getSwapQuote, executeSwap } from '../lib/algorand/swap';
import type { SwapQuote } from '../lib/algorand/swap';
import { keystoreRetrieve } from '../lib/keystore';

export function swapView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return el('div'); }
  if (account.name.startsWith('Watch')) {
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
  const assets = [
    { assetId: 0, unitName: 'ALGO', name: 'Algorand', decimals: 6, amount: info?.amount || 0 },
    ...(info?.assets || []).filter(a => !a.isFrozen).map(a => ({
      assetId: a.assetId,
      unitName: a.unitName || `ASA#${a.assetId}`,
      name: a.name || a.unitName || `ASA #${a.assetId}`,
      decimals: a.decimals ?? DEFAULT_DECIMALS,
      amount: a.amount,
    })),
  ];

  let inputAssetIdx = 0;
  let outputAssetIdx = assets.length > 1 ? 1 : 0;
  let inputAmount = '';
  let currentQuote: SwapQuote | null = null;
  let slippage = 50; // 0.5% default

  const quoteContainer = el('div', { cls: 'parsec-swap__quote' });

  // Asset selectors
  function makeSelect(selected: number, onChange: (idx: number) => void): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'bp5-input parsec-settings__select';
    assets.forEach((a, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      const bal = a.assetId === 0
        ? microAlgosToAlgo(a.amount)
        : formatAssetAmount(a.amount, a.decimals);
      opt.textContent = `${a.unitName} (${bal})`;
      opt.selected = i === selected;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(parseInt(sel.value, 10)));
    return sel;
  }

  const inputSelect = makeSelect(inputAssetIdx, (i) => { inputAssetIdx = i; });
  const outputSelect = makeSelect(outputAssetIdx, (i) => { outputAssetIdx = i; });

  const amountInput = input({
    type: 'number',
    placeholder: 'Amount',
    cls: 'bp5-input bp5-large bp5-fill',
    onInput: (v) => { inputAmount = v; },
  });

  async function fetchQuote() {
    const parsed = parseFloat(inputAmount);
    if (isNaN(parsed) || parsed <= 0) { toast('Enter an amount', 'danger'); return; }
    if (inputAssetIdx === outputAssetIdx) { toast('Select different assets', 'danger'); return; }

    const inAsset = assets[inputAssetIdx];
    const outAsset = assets[outputAssetIdx];
    const baseAmount = Math.round(parsed * Math.pow(10, inAsset.decimals));

    quoteContainer.innerHTML = '';
    quoteContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'Fetching quote...' }));

    const quote = await getSwapQuote(
      inAsset.assetId, outAsset.assetId, baseAmount, slippage, state.settings.network
    );

    quoteContainer.innerHTML = '';
    if (!quote) {
      quoteContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'No pool found for this pair. Try swapping through ALGO.' }));
      currentQuote = null;
      return;
    }

    currentQuote = quote;
    const outDisplay = formatAssetAmount(quote.outputAmount, outAsset.decimals);
    const minDisplay = formatAssetAmount(quote.minOutput, outAsset.decimals);
    const rateDisplay = quote.exchangeRate.toFixed(6);

    quoteContainer.appendChild(el('div', {
      cls: 'parsec-confirm__details',
      children: [
        row('You Send', `${parsed} ${inAsset.unitName}`),
        row('You Receive', `~${outDisplay} ${outAsset.unitName}`),
        row('Rate', `1 ${inAsset.unitName} = ${rateDisplay} ${outAsset.unitName}`),
        row('Min Received', `${minDisplay} ${outAsset.unitName}`),
        row('Price Impact', `${quote.priceImpact.toFixed(2)}%`),
        row('Slippage', `${slippage / 100}%`),
        row('Pool Fee', `0.3%`),
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
    if (!currentQuote) return;
    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Session expired.', 'danger'); store.navigate('unlock'); return; }

    const mnemonic = await keystoreRetrieve(account.address, passphrase);
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
    }
  }

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
      el('div', {
        cls: 'parsec-swap__form',
        children: [
          el('label', { cls: 'parsec-label', text: 'From' }),
          inputSelect,
          amountInput,
          el('label', { cls: 'parsec-label', text: 'To' }),
          outputSelect,
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
