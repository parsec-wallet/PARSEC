// Parsec Wallet — x402 Payment Confirmation View
// Shows payment details before signing. Displays BANKON holder discount.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { microAlgosToAlgo } from '../lib/algorand/account';
import type { PendingX402Payment } from '../lib/x402/payment';
import { executeX402Payment } from '../lib/x402/payment';

// The pending payment is set by the x402 payment flow before navigating here.
let pendingPayment: PendingX402Payment | null = null;
let resolvePayment: ((result: { success: boolean; response?: Response; error?: string }) => void) | null = null;

/** Set the pending payment before navigating to this view */
export function setX402Pending(
  payment: PendingX402Payment,
  resolve: (result: { success: boolean; response?: Response; error?: string }) => void,
): void {
  pendingPayment = payment;
  resolvePayment = resolve;
}

export function x402ConfirmView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const pending = pendingPayment;

  if (!account || !pending) {
    store.navigate('dashboard');
    return el('div');
  }

  const truncAddr = (a: string) => `${a.slice(0, 8)}...${a.slice(-6)}`;

  return el('div', {
    cls: 'parsec-view parsec-confirm',
    children: [
      // Header
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Cancel', {
            minimal: true, icon: 'arrow-left',
            onClick: () => {
              resolvePayment?.({ success: false, error: 'Cancelled by user' });
              pendingPayment = null;
              resolvePayment = null;
              store.navigate('dashboard');
            },
          }),
          el('h2', { cls: 'parsec-view__title', text: 'x402 Payment' }),
        ],
      }),

      // Service info
      el('div', {
        cls: 'parsec-confirm__details',
        children: [
          row('Service', pending.description),
          row('Endpoint', new URL(pending.url).pathname),
          row('Pay To', truncAddr(pending.requirement.payTo)),
          row('From', truncAddr(account.address)),
          divider(),
          row('Price (USD)', `$${pending.priceUsd.toFixed(4)}`),
          row('ALGO/USD', `$${pending.exchangeRate.toFixed(4)}`),
          ...(pending.isHolder ? [
            el('div', {
              cls: 'parsec-confirm__row parsec-confirm__discount',
              children: [
                el('span', { cls: 'parsec-confirm__label', text: 'BANKON Holder' }),
                el('span', {
                  cls: 'parsec-confirm__value parsec-confirm__badge-holder',
                  text: `${pending.bankonBalance.toLocaleString()} BANKON — 50% OFF`,
                }),
              ],
            }),
            row('Discounted Price', `$${pending.effectivePriceUsd.toFixed(4)}`),
          ] : []),
          divider(),
          row('You Pay', `${pending.effectivePriceAlgo.toFixed(6)} ALGO`),
          row('', `(${microAlgosToAlgo(Math.ceil(pending.effectivePriceAlgo * 1e6))} ALGO + ~0.001 fee)`),
          row('Network', state.settings.network.toUpperCase()),
        ],
      }),

      // Warning
      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-primary',
        children: [
          el('p', { text: 'Payment is sent to the x402 facilitator and settled on Algorand.' }),
        ],
      }),

      // Actions
      el('div', {
        cls: 'parsec-confirm__actions',
        children: [
          btn('Decline', {
            large: true, outlined: true,
            onClick: () => {
              resolvePayment?.({ success: false, error: 'Declined by user' });
              pendingPayment = null;
              resolvePayment = null;
              store.navigate('dashboard');
            },
          }),
          btn('Pay & Continue', {
            intent: 'primary', large: true,
            onClick: async () => {
              const passphrase = store.getPassphrase();
              if (!passphrase) {
                toast('Session expired.', 'danger');
                store.navigate('unlock');
                return;
              }

              store.set({ isLoading: true });
              try {
                const result = await executeX402Payment(
                  pending,
                  account.address,
                  passphrase,
                  state.settings.network,
                );

                if (result.success) {
                  toast('Payment settled.', 'success');
                  resolvePayment?.({ success: true, response: result.response });
                } else {
                  toast(result.error || 'Payment failed.', 'danger');
                  resolvePayment?.({ success: false, error: result.error });
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error';
                toast(msg, 'danger');
                resolvePayment?.({ success: false, error: msg });
              } finally {
                store.set({ isLoading: false });
                pendingPayment = null;
                resolvePayment = null;
                store.navigate('dashboard');
              }
            },
          }),
        ],
      }),
    ],
  });
}

// ── Helpers ──────────────────────────────────────────────────────

function row(label: string, value: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [
      el('span', { cls: 'parsec-confirm__label', text: label }),
      el('span', { cls: 'parsec-confirm__value', text: value }),
    ],
  });
}

function divider(): HTMLElement {
  return el('hr', { cls: 'parsec-confirm__divider' });
}
