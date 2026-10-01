// PARSEC Wallet — "Ready for x402": what an Algorand account needs before it
// can pay for a request, read from the chain, with the next step for each.
//
//   1. an Algorand account                       (always, once one exists)
//   2. ALGO for fees and the opt-in (≥ 0.2)       → BUY ALGO · Receive
//   3. opted in to USDC (the payment asset)       → Add USDC (Keycore-signed)
//   4. a USDC balance                             → Swap ALGO → USDC · Receive
//
// x402 on Algorand is sponsored: the facilitator pays the network fee of the
// payment itself, so ALGO is needed only for the account's own minimum
// balance and the one-time opt-in.

import { el, btn, toast } from '../dom';
import { store } from '../store';
import { isTauri } from '../platform';
import { fetchAccountInfo } from '../algorand/account';
import { optInWithKeycore } from '../algorand/assets';
import { formatDecimal } from '../money';
import { USDC_ASA_MAINNET, USDC_ASA_TESTNET } from '../x402/networks';
import type { NetworkId } from '../../types/wallet';

const ALGO_NEEDED = 200_000; // 0.2 ALGO: minimum balance plus the USDC opt-in, with room for fees

export interface ReadyState {
  algoSpendable: number;
  optedIn: boolean;
  usdc: bigint;
}

/** The steps still open, in order; empty when the account can pay. */
export function openSteps(s: ReadyState): ('algo' | 'optin' | 'usdc')[] {
  const steps: ('algo' | 'optin' | 'usdc')[] = [];
  if (!s.optedIn && s.algoSpendable < ALGO_NEEDED) steps.push('algo');
  if (!s.optedIn) steps.push('optin');
  if (s.usdc === 0n) steps.push('usdc');
  return steps;
}

export function x402Ready(opts: { compact?: boolean } = {}): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const network = state.settings.network as NetworkId;
  const usdcId = network === 'mainnet' ? USDC_ASA_MAINNET : network === 'testnet' ? USDC_ASA_TESTNET : null;
  const root = el('section', { cls: `parsec-ready${opts.compact ? ' parsec-ready--compact' : ''}` });
  const address = account?.chains?.algorand ?? account?.address;

  const step = (done: boolean, title: string, detail: string, actions: HTMLElement[] = []) =>
    el('li', { cls: `parsec-ready__step${done ? ' parsec-ready__step--done' : ''}`, children: [
      el('span', { cls: 'parsec-ready__mark', text: done ? '✓' : '○', attrs: { 'aria-hidden': 'true' } }),
      el('div', { cls: 'parsec-ready__text', children: [
        el('strong', { text: title }),
        el('span', { text: detail }),
        ...(actions.length && !done ? [el('div', { cls: 'parsec-ready__actions', children: actions })] : []),
      ] }),
    ] });

  async function render(): Promise<void> {
    if (!address || !usdcId) {
      root.replaceChildren(el('p', { cls: 'parsec-ready__muted', text: address ? `x402 USDC is not set up for ${network}.` : 'Create an Algorand account to pay with x402.' }));
      return;
    }
    root.replaceChildren(el('p', { cls: 'parsec-ready__muted', text: 'Checking this account on chain…' }));
    let info;
    try {
      info = await fetchAccountInfo(address, network);
    } catch {
      root.replaceChildren(el('p', { cls: 'parsec-ready__muted', text: 'Could not read the account from the network.' }));
      return;
    }
    const spendable = Math.max(0, info.amount - info.minBalance);
    const holding = info.assets.find((a) => a.assetId === usdcId);
    const s: ReadyState = { algoSpendable: spendable, optedIn: !!holding, usdc: BigInt(holding?.amount ?? 0) };
    const open = openSteps(s);

    const addUsdc = btn('Add USDC', {
      intent: 'primary',
      onClick: async (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        if (!isTauri) { store.navigate('add-asset'); return; }
        b.disabled = true;
        try {
          await optInWithKeycore(address, usdcId, network);
          toast('Opted in to USDC. This account can now receive it.', 'success');
          void render();
        } catch (err) {
          toast(`Opt-in failed: ${err instanceof Error ? err.message : String(err)}`, 'danger', 8000);
          b.disabled = false;
        }
      },
    });

    root.replaceChildren(
      el('header', { cls: 'parsec-ready__head', children: [
        el('h3', { text: open.length ? 'Get ready for x402 payments' : 'Ready for x402 payments' }),
        el('span', { cls: `parsec-ready__badge${open.length ? '' : ' parsec-ready__badge--ok'}`, text: open.length ? `${3 - open.length} of 3` : 'Ready' }),
      ] }),
      el('ol', { cls: 'parsec-ready__steps', children: [
        step(!open.includes('algo'), 'ALGO for the opt-in', `${formatDecimal(BigInt(spendable), 6, { trim: true })} ALGO spendable. Payments themselves are fee-sponsored; ALGO covers the minimum balance and the one-time opt-in.`, [
          btn('BUY ALGO', { outlined: true, onClick: () => store.navigate('onramp') }),
          btn('Receive', { minimal: true, onClick: () => store.navigate('receive') }),
        ]),
        step(s.optedIn, 'USDC added', `Algorand USDC is ASA ${usdcId} (Circle). An account receives it only after opting in.`, [addUsdc]),
        step(s.usdc > 0n, 'USDC balance', `${formatDecimal(s.usdc, 6, { trim: true })} USDC. x402 prices are usually cents.`, [
          btn('Swap ALGO → USDC', { outlined: true, onClick: () => store.navigate('swap') }),
          btn('Receive USDC', { minimal: true, onClick: () => store.navigate('receive') }),
        ]),
      ] }),
    );
  }

  void render();
  return root;
}
