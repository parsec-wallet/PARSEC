// PARSEC Wallet — SPINTRADE.
//
// The Algorand DEX aggregator: quotes from every enabled source (Tinyman v2
// on-chain, Pact), direct or through ALGO, and the participant picks. Two ways
// in:
//
//   Swap to USDC     one tap — 5, 10 or 25 ALGO (or any amount) to USDC, the
//                    asset x402 pays in; if the account has not opted in to
//                    USDC yet, that comes first, inline
//   Any pair         from what the account holds, to any asset with a pool
//
// Holdings are read from the chain. Amounts are exact (money.ts) up to the DEX
// call. Swaps are signed by the PARSEC Keycore (lib/algorand/signer.ts); no
// phrase enters JavaScript on desktop.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { onCleanup } from '../lib/lifecycle';
import { fetchAccountInfo } from '../lib/algorand/account';
import { enrichAssets, DEFAULT_DECIMALS } from '../lib/algorand/assets';
import { walletSigner } from '../lib/algorand/signer';
import { optInAsset } from '../lib/algorand/opt-in';
import { fetchAllPairs, fetchBestQuote, executeMultiHopSwap, type MultiHopQuote } from '../lib/dex/spintrade';
import type { DexAsset } from '../lib/dex/types';
import { addSwapRecord, getSwapHistory, formatSwapDate } from '../lib/dex/history';
import { parseDecimal, formatDecimal } from '../lib/money';
import { USDC_ASA_MAINNET, USDC_ASA_TESTNET } from '../lib/x402/networks';
import type { NetworkId } from '../types/wallet';

interface Held { assetId: number; unitName: string; name: string; decimals: number; amount: bigint }

const SLIPPAGE = [10, 25, 50, 100, 200];

function fmt(base: bigint | number, decimals: number): string {
  return formatDecimal(BigInt(base), decimals, { trim: true, maxFractionDigits: Math.min(decimals, 6) }) || '0';
}

function pct(bps: number): string {
  return `${(bps / 100).toFixed(bps < 100 ? 2 : 1)}%`;
}

export function swapView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return el('div'); }
  const network = state.settings.network as NetworkId;
  const address = account.chains?.algorand ?? account.address;
  const usdcId = network === 'mainnet' ? USDC_ASA_MAINNET : network === 'testnet' ? USDC_ASA_TESTNET : null;

  const header = el('div', { cls: 'parsec-view__header', children: [
    btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
  ] });
  const hero = el('section', { cls: 'parsec-swap2__hero', children: [
    el('p', { cls: 'parsec-swap2__kicker', text: `Algorand · ${network} · Tinyman & Pact` }),
    el('h2', { cls: 'parsec-swap2__h', text: 'SPINTRADE' }),
    el('p', { cls: 'parsec-swap2__lede', text: 'The best price across Algorand’s exchanges, direct or through ALGO. You see the route, the minimum you receive and the price impact before you sign.' }),
  ] });
  const root = el('div', { cls: 'parsec-view parsec-swap2', children: [header, hero] });

  if (account.watchOnly) {
    root.appendChild(el('p', { cls: 'parsec-swap2__muted', text: 'Watch-only accounts cannot swap.' }));
    return root;
  }

  let held: Held[] = [];
  let from: Held | null = null;
  let to: DexAsset | null = null;
  let amountText = '';
  let slippageBps = 50;
  let seq = 0;

  // ── Quote panel (right) ───────────────────────────────────────────────────
  const quotePanel = el('aside', { cls: 'parsec-swap2__quote', children: [el('p', { cls: 'parsec-swap2__muted', text: 'Choose what to swap, and to what.' })] });

  function quoteRow(label: string, value: string): HTMLElement {
    return el('div', { cls: 'parsec-swap2__qrow', children: [el('span', { text: label }), el('strong', { text: value })] });
  }

  async function getQuote(): Promise<void> {
    const my = ++seq;
    if (!from || !to) { quotePanel.replaceChildren(el('p', { cls: 'parsec-swap2__muted', text: 'Choose what to swap, and to what.' })); return; }
    let base: bigint;
    try {
      base = parseDecimal(amountText || '0', from.decimals);
    } catch {
      quotePanel.replaceChildren(el('p', { cls: 'parsec-swap2__error', text: `${from.unitName} has ${from.decimals} decimal places.` }));
      return;
    }
    if (base <= 0n) { quotePanel.replaceChildren(el('p', { cls: 'parsec-swap2__muted', text: 'Enter an amount.' })); return; }
    if (base > from.amount) { quotePanel.replaceChildren(el('p', { cls: 'parsec-swap2__error', text: `That is more ${from.unitName} than this account holds (${fmt(from.amount, from.decimals)}).` })); return; }
    if (from.assetId === to.assetId) { quotePanel.replaceChildren(el('p', { cls: 'parsec-swap2__error', text: 'Choose two different assets.' })); return; }
    quotePanel.replaceChildren(el('p', { cls: 'parsec-swap2__muted', text: 'Asking Tinyman and Pact, direct and through ALGO…' }));
    const fromA = from;
    const toA = to;
    const q = await fetchBestQuote(fromA.assetId, toA.assetId, Number(base), slippageBps, network).catch(() => null);
    if (my !== seq) return;
    if (!q) { quotePanel.replaceChildren(el('p', { cls: 'parsec-swap2__error', text: 'No route found for this pair and amount.' })); return; }
    renderQuote(q, fromA, toA);
  }

  function renderQuote(q: MultiHopQuote, fromA: Held, toA: DexAsset): void {
    const route = q.isMultiHop ? `${fromA.unitName} → ALGO → ${toA.unitName}` : `${fromA.unitName} → ${toA.unitName}`;
    const swapBtn = btn(`Swap ${fmt(q.inputAmount, fromA.decimals)} ${fromA.unitName}`, {
      intent: 'primary', large: true, cls: 'parsec-swap2__go',
      onClick: () => void doSwap(q, fromA, toA, swapBtn),
    });
    quotePanel.replaceChildren(
      el('p', { cls: 'parsec-swap2__qkicker', text: `Best route · ${q.dex}` }),
      el('div', { cls: 'parsec-swap2__receive', children: [
        el('span', { text: 'You receive about' }),
        el('strong', { text: `${fmt(q.outputAmount, toA.decimals)} ${toA.unitName}` }),
      ] }),
      quoteRow('At least', `${fmt(q.minOutput, toA.decimals)} ${toA.unitName}`),
      quoteRow('Route', `${route}${q.isMultiHop ? ' (2 hops)' : ''}`),
      quoteRow('Rate', `1 ${fromA.unitName} ≈ ${q.exchangeRate.toPrecision(6)} ${toA.unitName}`),
      quoteRow('Price impact', `${q.priceImpact.toFixed(2)}%`),
      quoteRow('Pool fee', `${fmt(q.fee, fromA.decimals)} ${fromA.unitName} (${((q.fee / Math.max(1, q.inputAmount)) * 100).toFixed(2)}%)${q.isMultiHop ? ', first hop' : ''}`),
      quoteRow('Slippage tolerance', pct(slippageBps)),
      ...(q.priceImpact > 5 ? [el('p', { cls: 'parsec-swap2__error', text: 'High price impact: this trade moves the pool price noticeably. Consider a smaller amount.' })] : []),
      swapBtn,
      el('p', { cls: 'parsec-swap2__muted', text: 'Signed by the PARSEC Keycore. If the price moves past your tolerance before it lands, the swap fails and nothing is spent but the network fee.' }),
    );
  }

  async function doSwap(q: MultiHopQuote, fromA: Held, toA: DexAsset, b: HTMLButtonElement): Promise<void> {
    b.disabled = true;
    store.set({ isLoading: true });
    let signer: Awaited<ReturnType<typeof walletSigner>> | null = null;
    try {
      // The output asset must be held before it can be received.
      if (toA.assetId !== 0 && !held.some((h) => h.assetId === toA.assetId)) {
        toast(`Adding ${toA.unitName} to this account first (opt-in)…`, 'primary');
        await optInAsset(address, toA.assetId, network);
      }
      signer = await walletSigner(address);
      const { txId, hops } = await executeMultiHopSwap(q, signer, network);
      addSwapRecord({
        inputAssetId: q.inputAssetId, inputSymbol: fromA.unitName, inputAmount: q.inputAmount,
        outputAssetId: q.outputAssetId, outputSymbol: toA.unitName, outputAmount: q.outputAmount,
        txId, dex: q.dex, isMultiHop: q.isMultiHop, hops, network,
      });
      store.set({ accountInfo: null });
      toast(`Swapped. ${fmt(q.outputAmount, toA.decimals)} ${toA.unitName} on its way · ${txId.slice(0, 10)}…`, 'success', 10_000);
      await loadHoldings();
      historyBox.replaceWith(historyBox = renderHistory());
    } catch (e) {
      toast(`Swap failed: ${e instanceof Error ? e.message : String(e)}`, 'danger', 10_000);
    } finally {
      signer?.dispose();
      store.set({ isLoading: false });
      b.disabled = false;
    }
  }

  // ── Trade panel (left) ────────────────────────────────────────────────────
  const fromSelect = document.createElement('select');
  fromSelect.className = 'parsec-swap2__select';
  const amountInput = el('input', { cls: 'parsec-swap2__amount', attrs: { type: 'text', inputmode: 'decimal', placeholder: '0.0', 'aria-label': 'Amount to swap' } }) as HTMLInputElement;
  const fromBalance = el('span', { cls: 'parsec-swap2__bal' });
  const maxBtn = btn('Max', { minimal: true, cls: 'parsec-swap2__max' });
  const poolFilter = el('input', { cls: 'parsec-swap2__filter', attrs: { type: 'search', placeholder: 'Filter pools by ticker or id', 'aria-label': 'Filter pools' } }) as HTMLInputElement;
  const pools = el('div', { cls: 'parsec-swap2__pools' });
  let poolAssets: DexAsset[] = [];

  function paintPools(): void {
    const f = poolFilter.value.trim().toLowerCase();
    const list = poolAssets.filter((a) => !f || a.unitName.toLowerCase().includes(f) || a.name.toLowerCase().includes(f) || String(a.assetId) === f);
    pools.replaceChildren(...(list.length ? list.slice(0, 60).map((a) => {
      const card = el('button', {
        cls: `parsec-swap2__pool${to?.assetId === a.assetId ? ' parsec-swap2__pool--on' : ''}`,
        attrs: { type: 'button' },
        children: [
          el('strong', { text: a.unitName || a.name || `ASA ${a.assetId}` }),
          el('span', { text: a.assetId === usdcId ? 'USDC · verified' : `ASA ${a.assetId}` }),
          el('span', { text: a.poolLiquidity ? a.poolLiquidity : '' }),
        ],
      });
      card.addEventListener('click', () => { to = a; paintPools(); void getQuote(); });
      return card;
    }) : [el('p', { cls: 'parsec-swap2__muted', text: f ? 'No pool matches.' : 'No pools found for this asset.' })]));
  }

  async function loadPools(): Promise<void> {
    if (!from) return;
    pools.replaceChildren(el('p', { cls: 'parsec-swap2__muted', text: 'Finding pools…' }));
    poolAssets = await fetchAllPairs(from.assetId, network).catch(() => []);
    // USDC first: it is what x402 pays in.
    poolAssets.sort((a, b) => Number(b.assetId === usdcId) - Number(a.assetId === usdcId));
    paintPools();
  }

  function paintFrom(): void {
    fromSelect.replaceChildren(...held.map((h, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${h.unitName} · ${fmt(h.amount, h.decimals)}`;
      o.selected = h === from;
      return o;
    }));
    fromBalance.textContent = from ? `Balance ${fmt(from.amount, from.decimals)} ${from.unitName}` : '';
  }

  fromSelect.addEventListener('change', () => { from = held[Number(fromSelect.value)] ?? null; to = null; paintFrom(); void loadPools(); void getQuote(); });
  amountInput.addEventListener('input', () => { amountText = amountInput.value.trim(); void getQuote(); });
  maxBtn.addEventListener('click', () => {
    if (!from) return;
    // Keep 0.5 ALGO back for fees and the minimum balance when swapping ALGO.
    const keep = from.assetId === 0 ? 500_000n : 0n;
    const max = from.amount > keep ? from.amount - keep : 0n;
    amountInput.value = formatDecimal(max, from.decimals, { trim: true }) || '0';
    amountText = amountInput.value;
    void getQuote();
  });
  poolFilter.addEventListener('input', paintPools);

  const slip = el('div', { cls: 'parsec-swap2__slip', children: SLIPPAGE.map((bps) => {
    const b = el('button', { cls: 'parsec-swap2__chip', text: pct(bps), attrs: { type: 'button', 'aria-pressed': String(bps === slippageBps) } }) as HTMLButtonElement;
    b.addEventListener('click', () => {
      slippageBps = bps;
      for (const c of slip.querySelectorAll('button')) c.setAttribute('aria-pressed', String(c === b));
      void getQuote();
    });
    return b;
  }) });

  const trade = el('section', { cls: 'parsec-swap2__trade', children: [
    el('label', { cls: 'parsec-swap2__label', text: 'From' }),
    el('div', { cls: 'parsec-swap2__from', children: [fromSelect, amountInput, maxBtn] }),
    fromBalance,
    el('label', { cls: 'parsec-swap2__label', text: 'To' }),
    poolFilter,
    pools,
    el('label', { cls: 'parsec-swap2__label', text: 'Slippage tolerance' }),
    slip,
  ] });

  // ── Effortless: ALGO → USDC ───────────────────────────────────────────────
  const quick = el('section', { cls: 'parsec-swap2__quick' });
  function paintQuick(): void {
    if (!usdcId) { quick.hidden = true; return; }
    const algo = held.find((h) => h.assetId === 0);
    const hasUsdc = held.some((h) => h.assetId === usdcId);
    const pick = (amt: string) => {
      from = algo ?? null;
      to = poolAssets.find((a) => a.assetId === usdcId) ?? { assetId: usdcId, unitName: 'USDC', name: 'USD Coin', decimals: 6 };
      amountInput.value = amt;
      amountText = amt;
      paintFrom();
      paintPools();
      void getQuote();
    };
    quick.replaceChildren(
      el('div', { cls: 'parsec-swap2__quick-text', children: [
        el('strong', { text: 'Swap to USDC' }),
        el('span', { text: hasUsdc ? 'The asset x402 pays in. Pick an amount of ALGO; the best route is quoted at once.' : 'The asset x402 pays in. This account has not added USDC yet; add it first, then pick an amount.' }),
      ] }),
      el('div', { cls: 'parsec-swap2__quick-actions', children: hasUsdc
        ? ['5', '10', '25'].map((a) => btn(`${a} ALGO`, { outlined: true, onClick: () => pick(a) }))
          .concat([btn('Other amount', { minimal: true, onClick: () => { pick(''); amountInput.focus(); } })])
        : [btn('Add USDC', { intent: 'primary', onClick: async (e) => {
          const b = e.currentTarget as HTMLButtonElement;
          b.disabled = true;
          try {
            await optInAsset(address, usdcId, network);
            toast('USDC added.', 'success');
            await loadHoldings();
          } catch (err) {
            toast(`Opt-in failed: ${err instanceof Error ? err.message : String(err)}`, 'danger', 8000);
            b.disabled = false;
          }
        } })] }),
    );
  }

  // ── History ───────────────────────────────────────────────────────────────
  function renderHistory(): HTMLElement {
    const history = getSwapHistory();
    if (history.length === 0) return el('div');
    return el('section', { cls: 'parsec-swap2__history', children: [
      el('h3', { text: 'Recent swaps' }),
      ...history.slice(0, 10).map((r) => el('div', { cls: 'parsec-swap2__hrow', children: [
        el('span', { text: formatSwapDate(r.timestamp) }),
        el('strong', { text: `${r.inputSymbol} → ${r.outputSymbol}` }),
        el('span', { text: r.isMultiHop ? `${r.hops} hops` : r.dex }),
        el('code', { text: `${r.txId.slice(0, 10)}…`, attrs: { title: r.txId } }),
      ] })),
    ] });
  }
  let historyBox = renderHistory();

  async function loadHoldings(): Promise<void> {
    try {
      const info = await fetchAccountInfo(address, network);
      const assets = await enrichAssets(info.assets.filter((a) => !a.isFrozen), network);
      held = [
        { assetId: 0, unitName: 'ALGO', name: 'Algorand', decimals: 6, amount: BigInt(info.amount) },
        ...assets.map((a) => ({
          assetId: a.assetId, unitName: a.unitName || `ASA ${a.assetId}`, name: a.name || a.unitName || `ASA ${a.assetId}`,
          decimals: a.decimals ?? DEFAULT_DECIMALS, amount: BigInt(a.amount),
        })),
      ];
    } catch {
      toast('Could not read this account’s balances.', 'warning');
      held = [{ assetId: 0, unitName: 'ALGO', name: 'Algorand', decimals: 6, amount: 0n }];
    }
    from = held.find((h) => h.assetId === from?.assetId) ?? held[0];
    paintFrom();
    paintQuick();
  }

  onCleanup(() => { seq++; });
  root.append(
    quick,
    el('div', { cls: 'parsec-swap2__grid', children: [trade, quotePanel] }),
    historyBox,
  );
  void loadHoldings().then(() => loadPools());
  return root;
}
