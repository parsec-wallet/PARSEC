// Stores tab — browse the open .algo subdomain stores and quote a name.
//
// Every store is a root .algo name whose owner sells subdomains under it at
// their own tier prices. A quote shows the tier, the owner's price, the BANKON
// fee on its own line, the total, and whether the name is free (from the NFD
// registry). Buying — paying the owner over x402, the owner's wallet minting
// the name for you — opens in the next phase.

import { el, btn } from '../lib/dom';
import { onCleanup } from '../lib/lifecycle';
import { listStores, quoteName, usd, TIER_LABEL, type Store, type Tier } from '../lib/nfd/stores';
import type { NetworkId } from '../types/wallet';

export function buildStoresTab(network: NetworkId): HTMLElement {
  const root = el('div', { cls: 'parsec-stores' });
  const list = el('div', { cls: 'parsec-stores__list' });
  const shop = el('section', { cls: 'parsec-stores__shop' });
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
          btn('Buy — opens next', { intent: 'primary', disabled: true }),
          el('p', { cls: 'parsec-stores__muted', text: 'Buying opens in the next phase: you pay the owner over x402, and the owner’s wallet mints the name for your address.' }),
        );
      } catch (e) {
        if (my !== seq) return;
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
  root.append(el('aside', { cls: 'parsec-stores__side', children: [el('h3', { text: 'Open stores' }), list] }), shop);
  return root;
}

function row(label: string, value: string, strong = false): HTMLElement {
  return el('div', { cls: `parsec-stores__row${strong ? ' parsec-stores__row--total' : ''}`, children: [el('span', { text: label }), el('strong', { text: value })] });
}
