// PARSEC Wallet — x402 Payment Confirmation.
//
// The last thing a participant sees before a payment group is signed. It shows what is
// actually being signed: the atomic amount and its asset, the network, who receives it,
// and — when the rail could read them — the reasons it would fail. A mainnet payment says
// so in a colour, because the difference between a testnet cent and a real one is the
// whole difference.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { explorerTxUrl } from '../lib/x402/networks';
import { signPayment, submitPayment, recheckPayment, type PendingX402Payment, type X402PaymentResult } from '../lib/x402/client';

type Resolver = (result: X402PaymentResult) => void;

let pendingPayment: PendingX402Payment | null = null;
let resolvePayment: Resolver | null = null;

/** Hand the confirmation surface a payment, then navigate to `x402-confirm`. */
export function setX402Pending(payment: PendingX402Payment, resolve: Resolver): void {
  pendingPayment = payment;
  resolvePayment = resolve;
}

/**
 * Approve a payment through this view.
 *
 * The shape `x402Request({ approve })` wants: it navigates here, waits for a decision,
 * and — because signing and sending happen here where the participant is watching —
 * resolves with the completed result rather than a bare boolean. The caller's `approve`
 * returns false either way, so the flow does not then pay a second time.
 */
export function approveThroughView(pending: PendingX402Payment): Promise<X402PaymentResult> {
  return new Promise<X402PaymentResult>((resolve) => {
    setX402Pending(pending, resolve);
    store.navigate('x402-confirm');
  });
}

export function x402ConfirmView(): HTMLElement {
  const pending = pendingPayment;
  if (!pending) {
    store.navigate('dashboard');
    return el('div');
  }

  const truncAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
  const blockers = pending.preflight?.blockers ?? [];
  const blocked = blockers.length > 0;

  const finish = (result: X402PaymentResult) => {
    resolvePayment?.(result);
    pendingPayment = null;
    resolvePayment = null;
    store.navigate('dashboard');
  };

  const decline = () => finish({ success: false, error: 'Declined by user' });

  const pay = async () => {
    store.set({ isLoading: true });
    try {
      const payment = await signPayment(pending);
      const result = await submitPayment(pending, payment);
      if (result.success) {
        const link = result.txId ? explorerTxUrl(pending.requirement.network, result.txId) : '';
        toast(result.txId ? `Settled — ${result.txId}` : 'Settled.', 'success', link ? 12_000 : undefined);
      } else if (result.txId) {
        // The payment settled; the resource did not deliver. Two different facts.
        toast(`Paid (${result.txId}) but the resource failed: ${result.error}`, 'warning', 15_000);
      } else {
        toast(result.error || 'Payment failed.', 'danger');
      }
      finish(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast(message, 'danger');
      finish({ success: false, error: message });
    } finally {
      store.set({ isLoading: false });
    }
  };

  return el('div', {
    cls: 'parsec-view parsec-confirm',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Cancel', { minimal: true, icon: 'arrow-left', onClick: decline }),
          el('h2', { cls: 'parsec-view__title', text: 'x402 Payment' }),
        ],
      }),

      pending.mainnet
        ? el('div', {
            cls: 'parsec-callout bp5-callout bp5-intent-warning',
            children: [el('p', { text: `${pending.quote.networkLabel} — this moves real value.` })],
          })
        : el('div', {
            cls: 'parsec-callout bp5-callout',
            children: [el('p', { text: `${pending.quote.networkLabel} — test funds.` })],
          }),

      el('div', {
        cls: 'parsec-confirm__details',
        children: [
          row('Resource', pending.challenge.resource.description || new URL(pending.url).pathname),
          row('Endpoint', pending.url),
          ...(pending.bazaar?.input?.method ? [row('Method', String(pending.bazaar.input.method))] : []),
          divider(),
          row('You pay', `${pending.quote.amountDisplay} ${pending.quote.assetSymbol}`),
          ...(pending.quote.usdDisplay
            ? [row(pending.quote.usdSource === 'oracle' ? 'Approx. USD' : 'USD', pending.quote.usdDisplay)]
            : []),
          row('Atomic units', `${pending.quote.amountAtomic} (${pending.quote.decimals} decimals)`),
          divider(),
          row('To', truncAddr(pending.requirement.payTo)),
          row('From', truncAddr(pending.payer)),
          row('Network', pending.quote.networkLabel),
          row('Scheme', pending.requirement.scheme),
          row(
            'Fees',
            typeof pending.requirement.extra?.feePayer === 'string'
              ? `sponsored by ${truncAddr(pending.requirement.extra.feePayer as string)}`
              : 'paid by you',
          ),
          ...(pending.preflight?.balance !== undefined
            ? [row('Your balance', `${pending.preflight.balance} atomic units`)]
            : []),
        ],
      }),

      ...(pending.alternatives.length > 1
        ? [
            el('div', {
              cls: 'parsec-confirm__details',
              children: [
                el('p', { cls: 'parsec-muted', text: 'The server also offered:' }),
                ...pending.alternatives
                  .filter((q) => q.requirement !== pending.requirement)
                  .map((q) => row(q.networkLabel, `${q.amountDisplay} ${q.assetSymbol}`)),
              ],
            }),
          ]
        : []),

      ...blockers.map((b) =>
        el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-danger',
          children: [
            el('p', { text: b.message }),
            ...(b.remedy
              ? [
                  btn(b.remedy.label, {
                    intent: 'primary',
                    onClick: async (e) => {
                      const button = e.currentTarget as HTMLButtonElement;
                      button.disabled = true;
                      try {
                        await b.remedy!.run();
                        // Seamless: re-check the same payment and redraw in place.
                        // If nothing else blocks it, Pay is enabled at once.
                        pendingPayment = await recheckPayment(pending);
                        const fresh = x402ConfirmView();
                        button.closest('.parsec-confirm')?.replaceWith(fresh);
                        const ready = pendingPayment.preflight?.ok !== false;
                        toast(ready ? 'Done. The payment is ready to approve.' : 'Done. Something else still blocks this payment.', ready ? 'success' : 'warning');
                      } catch (err) {
                        toast(err instanceof Error ? err.message : String(err), 'danger');
                        button.disabled = false;
                      }
                    },
                  }),
                ]
              : []),
          ],
        }),
      ),

      el('div', {
        cls: 'parsec-confirm__actions',
        children: [
          btn('Decline', { large: true, outlined: true, onClick: decline }),
          btn(blocked ? 'Blocked' : 'Pay & Continue', {
            intent: 'primary',
            large: true,
            disabled: blocked,
            onClick: pay,
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
