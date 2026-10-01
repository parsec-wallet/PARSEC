// PARSEC Wallet — open (or edit) a name store, for a name the account owns: a
// root .algo name (selling subdomains) or an ArNS name (selling undernames). Prices are USDC per tier — 3 letters and shorter premium, 4
// valuable, 5 and longer standard — prefilled with PARSEC's suggestions. The
// listing is signed by the owner's key in the PARSEC Keycore and published to
// the store registry; it is the owner's signature, checked against the NFD
// registry, that makes it valid. See lib/nfd/stores.ts.

import { el, btn, input, toast } from '../dom';
import { parseDecimal, formatDecimal } from '../money';
import {
  SUGGESTED_TIERS, TIER_LABEL, bankonFeeMicro, cleanLabels, fullName, getStore, publishListing, usd,
  type StoreListing, type StoreRegistry, type Tier,
} from '../nfd/stores';

const TIERS: Tier[] = ['premium', 'valuable', 'standard'];

/**
 * `owner` signs the listing (Algorand for .algo, Solana for ArNS); `payoutDefault` is where buyers
 * pay — an Algorand address opted in to USDC (for .algo, the owner itself).
 */
export function storeEditor(parent: string, owner: string, network: StoreRegistry, payoutDefault: string = owner): HTMLElement {
  const root = el('div', { cls: 'parsec-store-editor' });
  const arns = network === 'arns';

  const prices: Record<Tier, HTMLInputElement> = {} as Record<Tier, HTMLInputElement>;
  const example = el('p', { cls: 'parsec-store-editor__example' });
  const status = el('p', { cls: 'parsec-store-editor__status', attrs: { 'aria-live': 'polite' } });

  const tierRows = TIERS.map((t) => {
    const f = input({
      value: formatDecimal(BigInt(SUGGESTED_TIERS[t]), 6, { trim: true }),
      cls: 'bp5-input parsec-store-editor__price',
      onInput: () => paintExample(),
    });
    f.inputMode = 'decimal';
    prices[t] = f;
    return el('label', { cls: 'parsec-store-editor__tier', children: [
      el('span', { text: TIER_LABEL[t] }),
      el('span', { cls: 'parsec-store-editor__usd', children: ['$', f, el('span', { text: 'USDC' })] }),
    ] });
  });

  const payout = input({ value: payoutDefault, cls: 'bp5-input parsec-store-editor__payout' });
  const reserved = el('textarea', { cls: 'bp5-input parsec-store-editor__list', attrs: { rows: '2', placeholder: 'Reserved names, never sold: admin, support, …' } }) as HTMLTextAreaElement;
  const featured = el('textarea', { cls: 'bp5-input parsec-store-editor__list', attrs: { rows: '2', placeholder: 'Featured names shown first: agent, shop, …' } }) as HTMLTextAreaElement;

  function micro(t: Tier): number | null {
    try { return Number(parseDecimal(prices[t].value || '0', 6)); } catch { return null; }
  }

  function paintExample(): void {
    const std = micro('standard');
    example.textContent = std === null
      ? 'Prices are USDC with up to 6 decimals.'
      : `A buyer of a 5-letter name pays ${usd(std)} to you, plus the BANKON facilitation fee of ${usd(bankonFeeMicro(std))} (10 %, at least $0.05) — ${usd(std + bankonFeeMicro(std))} in all. You receive ${usd(std)} in full.`;
  }
  paintExample();

  async function publish(closed: boolean, b: HTMLButtonElement): Promise<void> {
    const tiers = {} as Record<Tier, number>;
    for (const t of TIERS) {
      const m = micro(t);
      if (m === null || m < 0) { toast(`The ${t} price is not a valid amount.`, 'danger'); return; }
      tiers[t] = m;
    }
    const listing: StoreListing = {
      network,
      parent, owner,
      payout: payout.value.trim(),
      tiers,
      reserved: cleanLabels(reserved.value, network),
      featured: cleanLabels(featured.value, network),
      issued_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ...(closed ? { closed: true } : {}),
    };
    b.disabled = true;
    status.textContent = 'Signing with the PARSEC Keycore and publishing…';
    status.dataset.tone = '';
    try {
      const r = await publishListing(listing);
      status.textContent = r.status === 'closed' ? 'Store closed.' : `Store open: names under ${parent} are in the Marketspace.`;
      status.dataset.tone = 'ok';
      toast(r.status === 'closed' ? `${parent} store closed` : `${parent} store is open`, 'success');
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
      status.dataset.tone = 'error';
    } finally {
      b.disabled = false;
    }
  }

  const open = btn('Sign & open store', { intent: 'primary', onClick: (e) => void publish(false, e.currentTarget as HTMLButtonElement) });
  const close = btn('Close store', { minimal: true, onClick: (e) => void publish(true, e.currentTarget as HTMLButtonElement) });
  close.hidden = true;

  // An existing listing fills the form and turns the button into "update".
  void getStore(parent, network).then((s) => {
    if (!s) return;
    for (const t of TIERS) prices[t].value = formatDecimal(BigInt(s.tiers_micro_usd[t] ?? 0), 6, { trim: true });
    payout.value = s.payout;
    featured.value = (s.featured ?? []).join(', ');
    if (!Array.isArray(s.reserved)) {
      // Re-signing without the stored reserved list would put those names on sale.
      open.disabled = true;
      close.hidden = true;
      status.textContent = 'The store registry did not send this store\'s reserved names, so it cannot be updated safely from here yet. Nothing was changed.';
      status.dataset.tone = 'error';
      return;
    }
    reserved.value = s.reserved.join(', ');
    open.querySelector('.bp5-button-text')!.textContent = 'Sign & update store';
    close.hidden = false;
    status.textContent = `Store is open since ${s.updated_at.slice(0, 10)}.`;
    status.dataset.tone = 'ok';
    paintExample();
  });

  root.append(
    el('p', { cls: 'parsec-store-editor__muted', text: arns
      ? `Sell undernames of ${parent}: ${fullName(network, parent, 'alice')}.ar.io. You set the prices; buyers pay you in USDC on Algorand over x402, and your wallet sets each undername and hands it to its buyer. Each buyer pays the BANKON facilitation fee on top; the price comes to you in full.`
      : `Sell subdomains of ${parent}: ${fullName(network, parent, 'alice')}. You set the prices; buyers pay you in USDC over x402, and your wallet mints each name for its buyer. Each buyer pays the BANKON facilitation fee on top; the price comes to you in full.` }),
    el('div', { cls: 'parsec-store-editor__tiers', children: tierRows }),
    example,
    el('label', { cls: 'parsec-store-editor__field', children: [el('span', { text: arns ? 'Payout — an Algorand address opted in to USDC' : 'Payout address (must hold USDC)' }), payout] }),
    el('label', { cls: 'parsec-store-editor__field', children: [el('span', { text: 'Reserved' }), reserved] }),
    el('label', { cls: 'parsec-store-editor__field', children: [el('span', { text: 'Featured' }), featured] }),
    el('div', { cls: 'parsec-store-editor__actions', children: [open, close] }),
    status,
  );
  return root;
}
