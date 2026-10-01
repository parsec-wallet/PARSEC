// PARSEC Wallet — BAZAAR.
//
// The catalogue of paid resources that settle through the configured facilitator:
// APIs and agent services that charge per request over x402. Browsing is free —
// reading what an endpoint takes and returns, what it costs and how many payments
// it has actually settled — all before any decision to pay.
//
// Prices shown are the catalogue's memory, formatted exactly (money.ts). The price
// a payment is made against is read live from the resource's own 402 every time,
// and shown on the approval screen.
//
// Catalogue entries are outside data: every string is cleaned (control and
// bidi-override characters stripped, length capped) and only https endpoints can
// be paid or opened. Nothing in a listing can pay by itself.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { onCleanup } from '../lib/lifecycle';
import { listResources, bestOffer, type BazaarResource } from '../lib/x402/bazaar';
import { getX402Settings } from '../lib/x402/settings';
import { describeNetwork } from '../lib/x402/networks';
import { discoverRequirements, preparePayment } from '../lib/x402/client';
import { signersForAccount } from '../lib/x402/adapters/parsec';
import { cleanText } from '../lib/agenticplace/directory';
import { approveThroughView } from './x402-confirm';
import { prefillDesk } from './x402-desk';

const PAGE = 24;
type NetFilter = 'all' | 'algorand' | 'base' | 'solana';
type MethodFilter = 'all' | 'GET' | 'POST';

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u : null;
  } catch { return null; }
}

function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function ago(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = Math.max(0, Date.now() - t);
  const day = 86_400_000;
  if (d < 3_600_000) return 'active this hour';
  if (d < day) return 'active today';
  if (d < 30 * day) return `active ${Math.floor(d / day)}d ago`;
  return `last seen ${new Date(t).toISOString().slice(0, 10)}`;
}

function summariseInput(inputSpec: NonNullable<BazaarResource['info']>['input']): string {
  if (!inputSpec) return '';
  if (inputSpec.type === 'mcp') return `MCP tool ${inputSpec.name ?? ''}`.trim();
  const query = inputSpec.queryParams ? Object.keys(inputSpec.queryParams) : [];
  const body = inputSpec.body ? Object.keys(inputSpec.body) : [];
  if (query.length) return `query: ${query.join(', ')}`;
  if (body.length) return `${inputSpec.bodyType ?? 'json'} body: ${body.join(', ')}`;
  return inputSpec.method ?? '';
}

export function x402BazaarView(): HTMLElement {
  const settings = getX402Settings();
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const signers = account ? signersForAccount(account) : {};
  const canPayAtAll = Object.keys(signers).length > 0;
  const facilitatorHost = safeUrl(settings.facilitatorUrl)?.host ?? settings.facilitatorUrl;

  let query = '';
  let offset = 0;
  let net: NetFilter = 'all';
  let method: MethodFilter = 'all';
  let includeTestnets = describeNetwork(settings.preferNetwork).testnet;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const search = el('input', {
    cls: 'parsec-bazaar__input',
    attrs: { type: 'search', placeholder: 'Search paid APIs and agent services — weather, oracle, mint, data…', 'aria-label': 'Search the Bazaar', maxlength: '100', spellcheck: 'false', autocomplete: 'off' },
  }) as HTMLInputElement;
  const status = el('p', { cls: 'parsec-bazaar__status', attrs: { 'aria-live': 'polite' } });
  const grid = el('div', { cls: 'parsec-bazaar__grid' });
  const more = btn('Load more', { outlined: true, cls: 'parsec-bazaar__more' });
  more.hidden = true;

  function chipGroup<T extends string>(label: string, options: [T, string][], get: () => T, set: (v: T) => void): HTMLElement {
    const group = el('div', { cls: 'parsec-bazaar__chips', attrs: { role: 'group', 'aria-label': label } });
    const paint = () => {
      for (const b of group.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.v === get()));
    };
    for (const [v, text] of options) {
      const b = el('button', { cls: 'parsec-bazaar__chip', text, attrs: { type: 'button', 'data-v': v } }) as HTMLButtonElement;
      b.addEventListener('click', () => { set(v); paint(); void run(true); });
      group.appendChild(b);
    }
    paint();
    return group;
  }

  const testnetBox = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  testnetBox.checked = includeTestnets;
  testnetBox.addEventListener('change', () => { includeTestnets = testnetBox.checked; void run(true); });

  function matchesFilters(r: BazaarResource): boolean {
    if (method !== 'all' && r.method.toUpperCase() !== method) return false;
    if (net === 'all') return true;
    return r.accepts.some((a) => describeNetwork(a.network).label.toLowerCase().includes(net));
  }

  function card(r: BazaarResource): HTMLElement | null {
    const url = safeUrl(r.resourceUrl);
    if (!url) return null;
    const title = cleanText(r.description, 140) || url.host;
    const offer = bestOffer(r);
    const m = r.method.toUpperCase();
    const tile = el('span', { cls: 'parsec-bazaar__tile', text: url.host.replace(/^www\./, '')[0]?.toUpperCase() ?? '?', attrs: { 'aria-hidden': 'true' } });
    tile.style.setProperty('--hue', String(hueOf(url.host)));

    const badges: HTMLElement[] = [el('span', { cls: 'parsec-bazaar__badge', text: m })];
    if (r.mimeType) badges.push(el('span', { cls: 'parsec-bazaar__badge', text: cleanText(r.mimeType, 32) }));
    if (r.settleCount) badges.push(el('span', { cls: 'parsec-bazaar__badge parsec-bazaar__badge--ok', text: `✓ ${r.settleCount.toLocaleString()} settled` }));
    const seen = ago(r.lastSeen);
    if (seen) badges.push(el('span', { cls: 'parsec-bazaar__badge', text: seen }));

    const takes = r.info?.input ? cleanText(summariseInput(r.info.input), 120) : '';
    const action = m === 'GET'
      ? btn(canPayAtAll ? 'Pay & open' : 'Add a wallet to pay', {
        intent: 'primary', cls: 'parsec-bazaar__act', disabled: !canPayAtAll || !offer,
        onClick: () => void pay(r),
      })
      : btn('Open in desk', {
        intent: 'primary', cls: 'parsec-bazaar__act', disabled: !offer,
        onClick: () => { prefillDesk({ url: url.href, method: m === 'POST' ? 'POST' : 'GET' }); store.navigate('x402-desk'); },
      });

    return el('article', { cls: 'parsec-bazaar__card', attrs: { tabindex: '0' }, children: [
      el('header', { cls: 'parsec-bazaar__head', children: [
        tile,
        el('div', { cls: 'parsec-bazaar__titles', children: [
          el('h3', { cls: 'parsec-bazaar__title', text: title }),
          el('code', { cls: 'parsec-bazaar__endpoint', text: `${url.host}${url.pathname}`, attrs: { title: url.href } }),
        ] }),
      ] }),
      el('div', { cls: 'parsec-bazaar__price', children: offer
        ? [el('strong', { text: `${offer.amount} ${offer.symbol}` }), el('span', { text: ` per request · ${offer.network}${offer.testnet ? ' (testnet)' : ''}` })]
        : [el('span', { text: 'No offer a PARSEC rail can pay' })] }),
      el('div', { cls: 'parsec-bazaar__badges', children: badges }),
      ...(takes ? [el('p', { cls: 'parsec-bazaar__takes', text: `Takes ${takes}` })] : []),
      el('footer', { cls: 'parsec-bazaar__foot', children: [
        action,
        ...(m !== 'GET' ? [el('span', { cls: 'parsec-bazaar__hint', text: 'Needs a request body' })] : [el('span', { cls: 'parsec-bazaar__hint', text: 'You approve the live price first' })]),
      ] }),
    ] });
  }

  async function run(reset: boolean): Promise<void> {
    const my = ++seq;
    if (reset) { offset = 0; grid.replaceChildren(); }
    status.textContent = reset ? 'Searching the catalogue…' : 'Loading more…';
    status.dataset.tone = '';
    try {
      const page = await listResources({ search: query || undefined, includeTestnets, limit: PAGE, offset });
      if (my !== seq) return;
      const shown = page.items.filter(matchesFilters).map(card).filter((c): c is HTMLElement => c !== null);
      for (const c of shown) grid.appendChild(c);
      offset += page.items.length;
      const count = grid.children.length;
      status.textContent = count === 0
        ? (query ? `Nothing payable matches “${query}”. Try another word, or include testnets.` : 'Nothing payable in the catalogue with these filters.')
        : `${page.total.toLocaleString()} catalogued · showing ${count}${query ? ` for “${query}”` : ''}`;
      more.hidden = offset >= page.total || page.items.length === 0;
    } catch (err) {
      if (my !== seq) return;
      status.textContent = `Could not read the catalogue: ${err instanceof Error ? err.message : String(err)}`;
      status.dataset.tone = 'error';
      more.hidden = true;
    }
  }

  async function pay(resource: BazaarResource): Promise<void> {
    if (!canPayAtAll) return;
    try {
      // The catalogue's price is a memory; the challenge is the quote.
      const challenge = await discoverRequirements(resource.resourceUrl);
      if (!challenge) { toast('That resource answered without asking for payment.', 'warning'); return; }
      const pending = await preparePayment(resource.resourceUrl, challenge, { signers });
      const result = await approveThroughView(pending);
      if (!result.success && result.error) toast(result.error, 'danger');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'danger');
    }
  }

  search.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { query = search.value.trim(); void run(true); }, 300);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { if (timer) clearTimeout(timer); query = search.value.trim(); void run(true); }
    if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; query = ''; void run(true); }
  });
  more.addEventListener('click', () => void run(false));
  onCleanup(() => { seq++; if (timer) clearTimeout(timer); });

  void run(true);

  return el('div', {
    cls: 'parsec-view parsec-bazaar',
    children: [
      el('div', { cls: 'parsec-view__header', children: [
        btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
      ] }),
      el('section', { cls: 'parsec-bazaar__hero', children: [
        el('p', { cls: 'parsec-bazaar__kicker', text: 'x402 · pay per request' }),
        el('h2', { cls: 'parsec-bazaar__h', text: 'BAZAAR' }),
        el('p', { cls: 'parsec-bazaar__lede', text: `Paid APIs and agent services that settle through ${facilitatorHost}. Browsing is free; every payment shows its live price and waits for your approval.` }),
      ] }),
      el('div', { cls: 'parsec-bazaar__bar', children: [
        el('span', { cls: 'parsec-bazaar__glass', text: '⌕', attrs: { 'aria-hidden': 'true' } }),
        search,
      ] }),
      el('div', { cls: 'parsec-bazaar__filters', children: [
        chipGroup<NetFilter>('Network', [['all', 'All networks'], ['algorand', 'Algorand'], ['base', 'Base'], ['solana', 'Solana']], () => net, (v) => { net = v; }),
        chipGroup<MethodFilter>('Method', [['all', 'Any method'], ['GET', 'GET'], ['POST', 'POST']], () => method, (v) => { method = v; }),
        el('label', { cls: 'parsec-bazaar__testnets', children: [testnetBox, el('span', { text: 'Include testnets' })] }),
      ] }),
      status,
      grid,
      more,
      el('p', { cls: 'parsec-bazaar__note', text: 'Listings come from the facilitator’s catalogue and are information, not endorsements. Prices shown are the catalogue’s; the payment is quoted live from the resource itself and shown for your approval before anything is signed.' }),
    ],
  });
}
