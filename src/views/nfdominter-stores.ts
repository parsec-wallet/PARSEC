// Stores tab — browse the open .algo subdomain stores and quote a name.
//
// Every store is a root .algo name whose owner sells subdomains under it at
// their own tier prices. A quote shows the tier, the owner's price, the BANKON
// fee on its own line, the total, and whether the name is free (from the NFD
// registry).
//
// BUY places an order (free; it freezes the figures), then pays it over x402 in
// two settlements the buyer can see: the BANKON fee, which holds the name for
// 15 minutes, then the price, straight to the store owner. The owner's wallet
// mints the name for the buyer. A step that fails leaves the order where it
// was, and "Your orders" resumes it without charging a paid step twice.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { onCleanup } from '../lib/lifecycle';
import { x402Ready } from '../lib/ui/x402-ready';
import { signersForAccount } from '../lib/x402/adapters/parsec';
import { explorerTxUrl } from '../lib/x402/networks';
import {
  buyerOrders, createOrder, listStores, payOrderStep, quoteName, stepTerms, usd, TIER_LABEL,
  type OrderStep, type Store, type StoreOrder, type Tier,
} from '../lib/nfd/stores';
import type { NetworkId } from '../types/wallet';

const STATE_LABEL: Record<string, string> = {
  quoted: 'Ordered — not paid',
  fee_paid: 'Fee paid — name held',
  paid: 'Paid — waiting for the owner to mint',
  minted: 'Minted',
  refunded: 'Refunded',
};

export function buildStoresTab(buyer: string, network: NetworkId): HTMLElement {
  const root = el('div', { cls: 'parsec-stores' });
  const list = el('div', { cls: 'parsec-stores__list' });
  const shop = el('section', { cls: 'parsec-stores__shop' });
  const mine = el('div', { cls: 'parsec-stores__orders' });
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => { seq++; if (timer) clearTimeout(timer); });

  function openShop(s: Store): void {
    for (const c of list.querySelectorAll('.parsec-stores__store')) c.classList.toggle('parsec-stores__store--on', (c as HTMLElement).dataset.parent === s.parent);
    const field = el('input', { cls: 'parsec-stores__input', attrs: { type: 'search', placeholder: `a name under ${s.parent}`, 'aria-label': 'Name to quote', maxlength: '27', spellcheck: 'false', autocomplete: 'off' } }) as HTMLInputElement;
    const quote = el('div', { cls: 'parsec-stores__quote' });

    async function run(): Promise<void> {
      const my = ++seq;
      const label = field.value.trim().toLowerCase();
      if (!label) { quote.replaceChildren(); return; }
      if (!/^[a-z0-9]{1,27}$/.test(label)) { quote.replaceChildren(el('p', { cls: 'parsec-stores__error', text: 'Names use a–z and 0–9, up to 27 characters.' })); return; }
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
            row('BANKON fee (5 %, min $0.10)', `${usd(q.bankon_fee_micro_usd)} USDC`),
            row('You pay', `${usd(q.total_micro_usd)} USDC`, true),
          ] }),
          ...(q.available ? [
            btn(`BUY ${q.name} · ${usd(q.total_micro_usd)} USDC`, { intent: 'primary', onClick: () => void order(s, label) }),
            el('p', { cls: 'parsec-stores__muted', text: `Two x402 payments in USDC: the BANKON fee, then the price straight to the owner of ${s.parent}. The owner’s wallet then mints the name for ${short(buyer)}.` }),
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
      const title = step === 'fee' ? `BANKON fee · ${usd(o.bankon_fee_micro_usd)} USDC`
        : step === 'pay' ? `Price · ${usd(o.price_micro_usd)} USDC to ${short(o.payout)}`
        : `Minted by the owner of ${o.parent}`;
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
          status.textContent = 'Paying the BANKON fee…';
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
            ? `Paid. The owner of ${o.parent} mints ${o.name} to ${short(o.buyer)}; it then appears in My Names.`
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
      list.replaceChildren(el('p', { cls: 'parsec-stores__muted', text: `No stores are open on ${network} yet. Own a root .algo name? Open one from My Names.` }));
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
