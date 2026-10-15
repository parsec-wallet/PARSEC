// PARSEC Wallet — the offer sheet: the delivery moment for anything PARSEC sells.
//
// One price, take it or leave it. Buy runs the caller's purchase; ✕ (or Escape) leaves
// cleanly: the sheet comes out of the DOM, its listeners go with it, the caller clears its
// own form, and the per-tab hand-offs PARSEC keeps in sessionStorage are forgotten.
//
// What "leave nothing behind" can and cannot mean here, honestly:
//  - Cache Storage: PARSEC opens no caches of its own (no caches.open anywhere in src) and
//    ships no service worker, so there is nothing of this flow's in it to delete. Logout
//    (lib/session.ts) still empties Cache Storage wholesale; this sheet does not, because
//    leaving an offer is not logging out.
//  - JavaScript cannot shred the WebView's own HTTP cache (the price quote's fetch, gateway
//    reads) and cannot overwrite memory: strings are immutable and the garbage collector
//    frees them when it pleases. Overwriting secrets in place is what the Rust Keycore does;
//    nothing secret ever enters this sheet, only a price.
//  - No toast on leaving: a toast would itself be a trace.

import { el, btn } from '../dom';
import { clearHandoffs } from '../permaweb/handoff';
import { onCleanup } from '../lifecycle';

export interface OfferOptions {
  /** The small label above the price, e.g. "Price". */
  kicker: string;
  /** The price, exactly as it will be signed, e.g. "12.5 ARIO". */
  price: string;
  /** One line saying what the price buys. */
  detail?: string;
  /** One line of fine print. */
  fine?: string;
  /** The Buy button's label (default "Buy"). */
  buyLabel?: string;
  /** Runs the purchase. Resolve to close the sheet; reject to show the error and stay open. */
  onBuy: () => Promise<void>;
  /** Called when the participant leaves (✕ or Escape): clear your own form state here. */
  onLeave?: () => void;
}

export interface OfferHandle {
  /** Close without buying — the same clean exit as ✕. */
  close(): void;
}

const C = 'parsec-offer';

export function openOffer(opts: OfferOptions): OfferHandle {
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let busy = false;
  let open = true;

  const kicker = el('p', { cls: `${C}__kicker`, text: opts.kicker, attrs: { id: `${C}-kicker` } });
  const price = el('p', { cls: `${C}__price`, text: opts.price, attrs: { id: `${C}-price` } });
  const error = el('p', { cls: `${C}__error`, attrs: { role: 'alert' } });
  error.hidden = true;

  const closeBtn = btn('✕', { minimal: true, cls: `${C}__close`, onClick: () => leave() });
  closeBtn.setAttribute('aria-label', 'Close and leave nothing behind');
  closeBtn.setAttribute('title', 'Close and leave nothing behind');

  const buyBtn = btn(opts.buyLabel ?? 'Buy', { intent: 'primary', large: true, cls: `${C}__buy`, onClick: () => void buy() });

  const sheet = el('div', {
    cls: `${C}__sheet`,
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${C}-kicker ${C}-price` },
    children: [
      closeBtn,
      kicker,
      price,
      ...(opts.detail ? [el('p', { cls: `${C}__detail`, text: opts.detail })] : []),
      ...(opts.fine ? [el('p', { cls: `${C}__fine`, text: opts.fine })] : []),
      error,
      buyBtn,
    ],
  });
  const root = el('div', { cls: C, children: [sheet] });

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); leave(); return; }
    if (e.key === 'Tab') {
      // Keep focus inside the sheet: two stops, ✕ and Buy (whichever are enabled).
      const stops = [closeBtn, buyBtn].filter((b) => !b.disabled);
      if (stops.length === 0) { e.preventDefault(); return; }
      const i = stops.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i + 1) % stops.length;
      e.preventDefault();
      stops[next].focus();
    }
  };

  /** Take the sheet down: out of the DOM, listeners off, focus back where it was. */
  const teardown = (): void => {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    if (before && before.isConnected) before.focus();
  };

  /** ✕ / Escape: leave cleanly. Ignored while a purchase is being signed — the result must be seen. */
  const leave = (): void => {
    if (!open || busy) return;
    teardown();
    clearHandoffs();
    opts.onLeave?.();
  };

  const buy = async (): Promise<void> => {
    if (!open || busy) return;
    busy = true;
    buyBtn.disabled = true;
    closeBtn.disabled = true;
    error.hidden = true;
    error.textContent = '';
    try {
      await opts.onBuy();
      busy = false;
      teardown();
    } catch (e) {
      busy = false;
      buyBtn.disabled = false;
      closeBtn.disabled = false;
      error.textContent = e instanceof Error ? e.message : String(e);
      error.hidden = false;
      buyBtn.focus();
    }
  };

  document.addEventListener('keydown', onKey, true);
  // The sheet hangs off <body>, outside the view; if the view is replaced under it, take it down too.
  onCleanup(teardown);
  document.body.appendChild(root);
  buyBtn.focus();

  return { close: leave };
}
