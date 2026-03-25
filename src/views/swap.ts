// Parsec Wallet — SpinTrade Swap View
// Aggregates quotes from all DEX modules. Participant picks the best price.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { microAlgosToAlgo } from '../lib/algorand/account';
import { formatAssetAmount, DEFAULT_DECIMALS } from '../lib/algorand/assets';
import { fetchAllPairs, fetchAllQuotes, executeSwapViaDex } from '../lib/dex/spintrade';
import type { DexQuote, DexAsset } from '../lib/dex/types';
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
  let selectedToAsset: DexAsset | null = null;
  let inputAmount = '';
  let slippageBps = 50; // Default 0.5% (50 basis points)

  const quoteContainer = el('div', { cls: 'parsec-swap__quote' });
  const toSelectContainer = el('div', { cls: 'parsec-swap__to-container' });

  // Custom slippage control
  const slippageOptions = [10, 25, 50, 100, 200]; // 0.1%, 0.25%, 0.5%, 1%, 2%
  const slippageLabel = el('span', { cls: 'parsec-swap__slippage-value', text: '0.5%' });
  const customSlippageInput = input({
    type: 'number',
    placeholder: 'Custom %',
    cls: 'bp5-input parsec-swap__slippage-custom',
    onInput: (v) => {
      const pct = parseFloat(v);
      if (!isNaN(pct) && pct > 0 && pct <= 50) {
        slippageBps = Math.round(pct * 100);
        slippageLabel.textContent = `${pct}%`;
        // Deselect preset buttons
        slippageRow.querySelectorAll('.parsec-swap__slippage-btn').forEach(b =>
          b.classList.remove('parsec-swap__slippage-btn--active'));
      }
    },
  });

  const slippageRow = el('div', { cls: 'parsec-swap__slippage', children: [
    el('span', { cls: 'parsec-label', text: 'Slippage Tolerance: ' }),
    slippageLabel,
    el('div', { cls: 'parsec-swap__slippage-presets', children:
      slippageOptions.map(bps => {
        const pct = (bps / 100).toFixed(bps < 100 ? 2 : 1);
        const isDefault = bps === 50;
        return btn(`${pct}%`, {
          minimal: true,
          cls: `parsec-swap__slippage-btn ${isDefault ? 'parsec-swap__slippage-btn--active' : ''}`,
          onClick: (e: Event) => {
            slippageBps = bps;
            slippageLabel.textContent = `${pct}%`;
            (customSlippageInput as HTMLInputElement).value = '';
            slippageRow.querySelectorAll('.parsec-swap__slippage-btn').forEach(b =>
              b.classList.remove('parsec-swap__slippage-btn--active'));
            (e.currentTarget as HTMLElement).classList.add('parsec-swap__slippage-btn--active');
          },
        });
      }),
    }),
    customSlippageInput,
  ]});

  // From select
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

    quoteContainer.innerHTML = '';
    loadOutputAssets();
  });

  // Load output assets from all DEX modules
  async function loadOutputAssets() {
    const fromAsset = heldAssets[selectedFromIdx];
    toSelectContainer.innerHTML = '';
    toSelectContainer.appendChild(el('div', { cls: 'parsec-swap__loading', text: 'Discovering tradeable assets...' }));

    const poolAssets = await fetchAllPairs(fromAsset.assetId, state.settings.network);

    toSelectContainer.innerHTML = '';
    if (poolAssets.length === 0) {
      toSelectContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'No liquidity pools found.' }));
      return;
    }

    const fromAssetName = heldAssets[selectedFromIdx].unitName;

    // Show pools as cards with liquidity info, not just a dropdown
    const poolList = el('div', { cls: 'parsec-swap__pool-list' });

    poolAssets.forEach(a => {
      const priceText = a.poolPrice
        ? `1 ${fromAssetName} = ${a.poolPrice.toFixed(a.poolPrice > 1 ? 2 : 6)} ${a.unitName}`
        : 'price unavailable';
      const liqText = a.poolLiquidity
        ? `Pool: ${a.poolLiquidity}`
        : '';

      const isSelected = selectedToAsset?.assetId === a.assetId;

      const card = el('div', {
        cls: `parsec-swap__pool-card ${isSelected ? 'parsec-swap__pool-card--selected' : ''}`,
        onClick: () => {
          selectedToAsset = a;
          quoteContainer.innerHTML = '';
          // Update selection UI
          poolList.querySelectorAll('.parsec-swap__pool-card').forEach(c => c.classList.remove('parsec-swap__pool-card--selected'));
          card.classList.add('parsec-swap__pool-card--selected');
        },
        children: [
          el('div', { cls: 'parsec-swap__pool-card-header', children: [
            el('span', { cls: 'parsec-swap__pool-card-name', text: a.unitName || a.name }),
            el('span', { cls: 'parsec-swap__pool-card-id', text: `ID: ${a.assetId}` }),
          ]}),
          el('div', { cls: 'parsec-swap__pool-card-price', text: priceText }),
          liqText ? el('div', { cls: 'parsec-swap__pool-card-liq', text: liqText }) : el('span'),
        ],
      });
      poolList.appendChild(card);
    });

    toSelectContainer.appendChild(poolList);
  }

  const amountInput = input({
    type: 'number',
    placeholder: 'Amount',
    cls: 'bp5-input bp5-large bp5-fill',
    onInput: (v) => { inputAmount = v; },
  });

  // Fetch quotes from ALL DEX sources — show all, participant picks best
  async function fetchQuotes() {
    const parsed = parseFloat(inputAmount);
    if (isNaN(parsed) || parsed <= 0) { toast('Enter an amount', 'danger'); return; }
    if (!selectedToAsset) { toast('Select an asset to receive', 'danger'); return; }

    const fromAsset = heldAssets[selectedFromIdx];
    if (fromAsset.assetId === selectedToAsset.assetId) { toast('Cannot swap to same asset', 'danger'); return; }

    const baseAmount = Math.round(parsed * Math.pow(10, fromAsset.decimals));

    quoteContainer.innerHTML = '';
    quoteContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'Fetching quotes from all sources...' }));

    const quotes = await fetchAllQuotes(
      fromAsset.assetId, selectedToAsset.assetId, baseAmount, slippageBps, state.settings.network
    );

    quoteContainer.innerHTML = '';
    if (quotes.length === 0) {
      quoteContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'No quotes available. Try a different pair or amount.' }));
  
      return;
    }

    // Show all quotes — best first
    const toAsset = selectedToAsset;
    for (let i = 0; i < quotes.length; i++) {
      const q = quotes[i];
      const isBest = i === 0;
      const outDisplay = formatAssetAmount(q.outputAmount, toAsset.decimals);
      const minDisplay = formatAssetAmount(q.minOutput, toAsset.decimals);

      const card = el('div', {
        cls: `parsec-swap__quote-card ${isBest ? 'parsec-swap__quote-card--best' : ''}`,
        children: [
          el('div', { cls: 'parsec-swap__quote-header', children: [
            el('span', { cls: 'parsec-swap__quote-dex', text: q.dex }),
            isBest ? el('span', { cls: 'parsec-badge', text: 'Best Price' }) : el('span'),
          ]}),
          row('You Receive', `${outDisplay} ${toAsset.unitName}`),
          row('Rate', `1 ${fromAsset.unitName} = ${q.exchangeRate.toFixed(6)} ${toAsset.unitName}`),
          row('Min Received', `${minDisplay} ${toAsset.unitName}`),
          row('Impact', `${q.priceImpact.toFixed(2)}%`),
          row('Fee', '0.3%'),
          row('Slippage', `${(slippageBps / 100).toFixed(slippageBps < 100 ? 2 : 1)}%`),
          btn(isBest ? 'Swap via ' + q.dex : 'Use this quote', {
            intent: isBest ? 'primary' : 'none',
            large: isBest,
            cls: 'parsec-swap__quote-action',
            onClick: () => doSwap(q),
          }),
        ],
      });
      quoteContainer.appendChild(card);
    }
  }

  async function doSwap(quote: DexQuote) {
    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Session expired.', 'danger'); store.navigate('unlock'); return; }

    let mnemonic: string | null = await keystoreRetrieve(account.address, passphrase);
    if (!mnemonic) { toast('Could not retrieve key.', 'danger'); return; }

    store.set({ isLoading: true });
    try {
      // Find which module can execute (prefer on-chain)
      const execDex = quote.dex.includes('on-chain') ? 'tinyman-onchain' : 'tinyman-onchain';
      const { txId } = await executeSwapViaDex(
        execDex, mnemonic,
        quote.inputAssetId, quote.outputAssetId,
        quote.inputAmount, quote.minOutput, quote.poolAddress,
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

  loadOutputAssets();

  return el('div', {
    cls: 'parsec-view parsec-swap',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'SpinTrade' }),
        ],
      }),
      el('p', { cls: 'parsec-view__desc', text: 'Best price from all sources. You choose the path.' }),
      el('div', {
        cls: 'parsec-swap__form',
        children: [
          el('label', { cls: 'parsec-label', text: 'From (your holdings)' }),
          fromSelect,
          amountInput,
          el('label', { cls: 'parsec-label', text: 'To (available pools)' }),
          toSelectContainer,
          slippageRow,
        ],
      }),
      btn('Find Best Price', { intent: 'primary', large: true, cls: 'parsec-send__submit', onClick: fetchQuotes }),
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
