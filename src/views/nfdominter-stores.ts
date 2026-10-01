// Name stores — browse the open stores of one registry (.algo subdomains or
// ArNS undernames), quote a name and buy it. Used by the .algo Names Stores tab
// and by the BANKON Marketspace (buildMarketspaceStores, both registries).
//
// Every store is a root .algo name whose owner sells subdomains under it at
// their own tier prices. A quote shows the tier, the owner's price, the BANKON
// fee on its own line, the total, and whether the name is free (from the NFD
// registry).
//
// BUY places an order (free; it freezes the figures), then pays it over x402 in
// two settlements the buyer can see: the BANKON facilitation fee (10 %, at
// least $0.05, on top of the price), which holds the name for
// 15 minutes, then the price, straight to the store owner. The owner's wallet
// mints the name for the buyer. A step that fails leaves the order where it
// was, and "Your orders" resumes it without charging a paid step twice.

import { el, btn, toast } from '../lib/dom';
import { onCleanup } from '../lib/lifecycle';
import { x402Ready } from '../lib/ui/x402-ready';
import { signersForAccount } from '../lib/x402/adapters/parsec';
import { explorerTxUrl } from '../lib/x402/networks';
import {
  algoRegistry, buyerOrders, createOrder, labelValid, listStores, payOrderStep, quoteName, stepTerms, usd, TIER_LABEL,
  type OrderStep, type Store, type StoreOrder, type StoreRegistry, type Tier,
} from '../lib/nfd/stores';
import { store, getAccountAddress } from '../lib/store';

const STATE_LABEL: Record<string, string> = {
  quoted: 'Ordered — not paid',
  fee_paid: 'Fee paid — name held',
  paid: 'Paid — waiting for the owner to mint',
  minted: 'Minted',
  refunded: 'Refunded',
};

const REGISTRY_LABEL: Record<StoreRegistry, string> = { mainnet: '.algo', testnet: '.algo (testnet)', arns: 'ar:// · ArNS' };

export function buildStoresTab(buyer: string, network: StoreRegistry): HTMLElement {
  const arns = network === 'arns';
  const root = el('div', { cls: 'parsec-stores' });
  const list = el('div', { cls: 'parsec-stores__list' });
  const shop = el('section', { cls: 'parsec-stores__shop' });
  const mine = el('div', { cls: 'parsec-stores__orders' });
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => { seq++; if (timer) clearTimeout(timer); });

  function openShop(s: Store): void {
    for (const c of list.querySelectorAll('.parsec-stores__store')) c.classList.toggle('parsec-stores__store--on', (c as HTMLElement).dataset.parent === s.parent);
    const field = el('input', { cls: 'parsec-stores__input', attrs: { type: 'search', placeholder: arns ? `an undername of ${s.parent}` : `a name under ${s.parent}`, 'aria-label': 'Name to quote', maxlength: arns ? '61' : '27', spellcheck: 'false', autocomplete: 'off' } }) as HTMLInputElement;
    const quote = el('div', { cls: 'parsec-stores__quote' });

    async function run(): Promise<void> {
      const my = ++seq;
      const label = field.value.trim().toLowerCase();
      if (!label) { quote.replaceChildren(); return; }
      if (!labelValid(network, label)) { quote.replaceChildren(el('p', { cls: 'parsec-stores__error', text: arns ? 'Undernames use a–z, 0–9 and inner hyphens, up to 61 characters.' : 'Names use a–z and 0–9, up to 27 characters.' })); return; }
      quote.replaceChildren(el('p', { cls: 'parsec-stores__muted', text: 'Quoting…' }));
      try {
        const q = await quoteName(s.parent, label, network);
        if (my !== seq) return;
        quote.replaceChildren(
          el('div', { cls: `parsec-stores__name${q.available ? '' : ' parsec-stores__name--taken'}`, children: [
            el('strong', { text: q.name }),
            el('span', { text: q.available ? 'Available' : `Not available — ${q.reason ?? 'taken'}` }),
          ] }),
          el('div', { cls: 'parsec-stores__rows', children: [
            row('Tier', TIER_LABEL[q.tier as Tier] ?? q.tier),
            row(`Price, to the owner of ${s.parent}`, `${usd(q.price_micro_usd)} USDC`),
            row('BANKON facilitation fee (10 %, min $0.05)', `${usd(q.bankon_fee_micro_usd)} USDC`),
            row('You pay', `${usd(q.total_micro_usd)} USDC`, true),
          ] }),
          ...(q.available ? [
            btn(`BUY ${q.name} · ${usd(q.total_micro_usd)} USDC`, { intent: 'primary', onClick: () => void order(s, label) }),
            el('p', { cls: 'parsec-stores__muted', text: `Two x402 payments in USDC on Algorand: the BANKON facilitation fee, then the price straight to the owner of ${s.parent}, in full. The owner’s wallet then ${arns ? 'sets the undername and hands it to your Solana address' : 'mints the name for'} ${short(buyer)}.` }),
          ] : []),
        );
      } catch (e) {
        if (my !== seq) return;
        quote.replaceChildren(el('p', { cls: 'parsec-stores__error', text: e instanceof Error ? e.message : String(e) }));
      }
    }

    async function order(s: Store, label: string): Promise<void> {
      quote.replaceChildren(el('p', { cls: 'parsec-stores__muted', text: 'Placing the order…' }));
      try {
        const o = await createOrder(s.parent, label, buyer, network);
        quote.replaceChildren(checkout(o));
        void paintOrders();
      } catch (e) {
        quote.replaceChildren(el('p', { cls: 'parsec-stores__error', text: e instanceof Error ? e.message : String(e) }));
      }
    }

    field.addEventListener('input', () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void run(), 350); });
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (timer) clearTimeout(timer); void run(); } });

    shop.replaceChildren(
      el('p', { cls: 'parsec-stores__kicker', text: 'Subdomain store' }),
      el('h3', { cls: 'parsec-stores__title', text: s.parent }),
      el('div', { cls: 'parsec-stores__tiers', children: (['premium', 'valuable', 'standard'] as Tier[]).map((t) => el('div', { children: [
        el('span', { text: TIER_LABEL[t] }),
        el('strong', { text: `${usd(s.tiers_micro_usd[t] ?? 0)}` }),
      ] })) }),
      ...(s.featured?.length ? [el('div', { cls: 'parsec-stores__featured', children: [
        el('span', { text: 'Featured' }),
        ...s.featured.slice(0, 12).map((f) => {
          const b = el('button', { cls: 'parsec-stores__chip', text: `${f}.${s.parent}`, attrs: { type: 'button' } });
          b.addEventListener('click', () => { field.value = f; void run(); });
          return b;
        }),
      ] })] : []),
      field,
      quote,
    );
    setTimeout(() => field.focus(), 30);
  }

  // ── Checkout: one order, two settlements ───────────────────────────────────

  function checkout(initial: StoreOrder): HTMLElement {
    let o = initial;
    const box = el('div', { cls: 'parsec-stores__checkout' });
    const status = el('p', { cls: 'parsec-stores__muted', attrs: { 'aria-live': 'polite' } });
    let busy = false;

    function stepRow(step: OrderStep | 'mint'): HTMLElement {
      const done = step === 'fee' ? o.state !== 'quoted' : step === 'pay' ? ['paid', 'minted'].includes(o.state) : o.state === 'minted';
      const tx = step === 'fee' ? o.fee_settlement : step === 'pay' ? o.settlement : o.mint_tx;
      const title = step === 'fee' ? `BANKON facilitation fee · ${usd(o.bankon_fee_micro_usd)} USDC`
        : step === 'pay' ? `Price · ${usd(o.price_micro_usd)} USDC to ${short(o.payout)}`
        : arns ? `Set and handed over by the owner of ${o.parent}` : `Minted by the owner of ${o.parent}`;
      const link = tx ? el('a', { cls: 'parsec-stores__tx', text: short(tx), attrs: { href: explorerTxUrl(stepTerms(o, 'fee').network, tx), target: '_blank', rel: 'noopener noreferrer' } }) : null;
      return el('div', { cls: `parsec-stores__step${done ? ' parsec-stores__step--done' : ''}`, children: [
        el('span', { cls: 'parsec-stores__dot', text: done ? '✓' : '○', attrs: { 'aria-hidden': 'true' } }),
        el('span', { text: title }),
        ...(link ? [link] : []),
      ] });
    }

    async function pay(): Promise<void> {
      if (busy) return;
      const state = store.get();
      const account = state.accounts[state.activeAccountIndex];
      if (!account || !store.getPassphrase()) { status.textContent = 'Unlock the wallet to pay.'; status.dataset.tone = 'error'; return; }
      busy = true;
      paint();
      const signers = signersForAccount(account);
      try {
        if (o.state === 'quoted') {
          status.textContent = 'Paying the BANKON facilitation fee…';
          o = (await payOrderStep(o, 'fee', signers)).order;
          paint();
        }
        if (o.state === 'fee_paid') {
          status.textContent = `Paying ${usd(o.price_micro_usd)} USDC to the owner of ${o.parent}…`;
          o = (await payOrderStep(o, 'pay', signers)).order;
        }
        toast(`${o.name} is paid for — the owner mints it to your address.`, 'success');
        status.textContent = '';
      } catch (e) {
        status.textContent = (e instanceof Error ? e.message : String(e))
          + (o.state === 'fee_paid' ? ` Your fee is paid and the name is held until ${heldUntil(o)}; paying again charges only the price.` : '');
        status.dataset.tone = 'error';
      } finally {
        busy = false;
        paint();
        void paintOrders();
      }
    }

    function paint(): void {
      const open = o.state === 'quoted' || o.state === 'fee_paid';
      box.replaceChildren(
        el('div', { cls: 'parsec-stores__name', children: [el('strong', { text: o.name }), el('span', { text: STATE_LABEL[o.state] ?? o.state })] }),
        el('div', { cls: 'parsec-stores__steps', children: [stepRow('fee'), stepRow('pay'), stepRow('mint')] }),
        ...(open ? [
          btn(busy ? 'Paying…' : o.state === 'quoted' ? `PAY ${usd(o.total_micro_usd)} USDC` : `PAY ${usd(o.price_micro_usd)} USDC TO THE OWNER`, {
            intent: 'primary', disabled: busy, onClick: () => void pay(),
          }),
          x402Ready({ compact: true }),
        ] : [
          el('p', { cls: 'parsec-stores__muted', text: o.state === 'paid'
            ? `Paid. The owner of ${o.parent} ${arns ? 'sets' : 'mints'} ${o.name} for ${short(o.buyer)}${arns ? ` — then served at ${o.name}.ar.io` : '; it then appears in My Names'}.`
            : `${o.name} is yours.` }),
        ]),
        status,
      );
    }
    paint();
    return box;
  }

  async function paintOrders(): Promise<void> {
    try {
      const orders = (await buyerOrders(buyer)).filter((o) => o.network === network);
      if (orders.length === 0) { mine.replaceChildren(); return; }
      mine.replaceChildren(el('h3', { text: 'Your orders' }), ...orders.slice(0, 20).map((o) => {
        const b = el('button', { cls: 'parsec-stores__store', attrs: { type: 'button' }, children: [
          el('strong', { text: o.name }),
          el('span', { text: `${STATE_LABEL[o.state] ?? o.state} · ${usd(o.total_micro_usd)}` }),
        ] });
        b.addEventListener('click', () => {
          for (const c of list.querySelectorAll('.parsec-stores__store')) c.classList.remove('parsec-stores__store--on');
          shop.replaceChildren(el('p', { cls: 'parsec-stores__kicker', text: 'Order' }), checkout(o));
        });
        return b;
      }));
    } catch { mine.replaceChildren(); }
  }
  void paintOrders();

  void listStores(network).then((stores) => {
    if (stores.length === 0) {
      list.replaceChildren(el('p', { cls: 'parsec-stores__muted', text: arns ? 'No ArNS stores are open yet. Own an ArNS name? Open a store from its name controller.' : `No ${REGISTRY_LABEL[network]} stores are open yet. Own a root .algo name? Open one from My Names.` }));
      return;
    }
    list.replaceChildren(...stores.map((s) => {
      const card = el('button', { cls: 'parsec-stores__store', attrs: { type: 'button', 'data-parent': s.parent }, children: [
        el('strong', { text: s.parent }),
        el('span', { text: `from ${usd(Math.min(...Object.values(s.tiers_micro_usd)))} · ${s.owner.slice(0, 6)}…` }),
      ] });
      card.addEventListener('click', () => openShop(s));
      return card;
    }));
    openShop(stores[0]);
  }).catch((e) => {
    list.replaceChildren(el('p', { cls: 'parsec-stores__error', text: `The store registry could not be reached: ${e instanceof Error ? e.message : String(e)}` }));
  });

  list.appendChild(el('p', { cls: 'parsec-stores__muted', text: 'Loading stores…' }));
  root.append(el('aside', { cls: 'parsec-stores__side', children: [el('h3', { text: 'Open stores' }), list, mine] }), shop);
  return root;
}

function row(label: string, value: string, strong = false): HTMLElement {
  return el('div', { cls: `parsec-stores__row${strong ? ' parsec-stores__row--total' : ''}`, children: [el('span', { text: label }), el('strong', { text: value })] });
}

function short(a: string): string {
  return a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function heldUntil(o: StoreOrder): string {
  return o.held_until ? new Date(o.held_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'soon';
}

/**
 * The Marketspace's name stores: every open store, .algo and ArNS, behind one switch.
 * The buyer address follows the registry — Algorand for .algo, Solana for ArNS.
 */
export function buildMarketspaceStores(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const algo = algoRegistry(state.settings.network);
  const registries: StoreRegistry[] = ['arns', algo];
  let current: StoreRegistry = 'arns';
  const body = el('div');
  const chips = registries.map((r) => {
    const b = el('button', { cls: 'parsec-stores__chip', text: r === 'arns' ? 'ar:// BANKON' : REGISTRY_LABEL[r], attrs: { type: 'button' } });
    b.addEventListener('click', () => { current = r; paint(); });
    return b;
  });

  function paint(): void {
    chips.forEach((c, i) => c.classList.toggle('parsec-stores__chip--on', registries[i] === current));
    const buyer = account ? getAccountAddress(account, current === 'arns' ? 'solana' : 'algorand') : undefined;
    if (!buyer) {
      body.replaceChildren(el('div', { cls: 'parsec-callout bp5-callout', children: [
        el('p', { text: current === 'arns' ? 'ArNS undernames are handed to a Solana address. Add one to this account to buy.' : 'Add an Algorand account to buy .algo names.' }),
        ...(current === 'arns' ? [btn('Import Solana key', { intent: 'primary', onClick: () => store.navigate('solana-import') })] : []),
      ] }));
      return;
    }
    body.replaceChildren(buildStoresTab(buyer, current));
  }
  paint();
  return el('section', { cls: 'parsec-stores__market', children: [
    el('div', { cls: 'parsec-stores__market-head', children: [
      el('h3', { text: 'Name stores' }),
      el('p', { cls: 'parsec-stores__muted', text: 'Names sold by their owners, priced by length. You pay the owner in USDC over x402, plus the BANKON facilitation fee of 10 % (at least $0.05), shown before you pay.' }),
      el('div', { cls: 'parsec-stores__featured', children: chips }),
    ] }),
    body,
  ] });
}
