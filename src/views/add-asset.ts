// PARSEC Wallet — ADD ASSETS (ASA opt-in), its own screen.
//
// On Algorand an account must opt in to an asset before it can receive it: a
// zero-amount transfer to itself, which raises the account's minimum balance
// by 0.1 ALGO (returned on opt-out) and costs the 0.001 ALGO network fee.
//
// Opt-in is also Algorand's protection against spam assets: nobody can drop a
// token into an account that did not ask for it, so a wallet's holdings are
// only what its owner chose (docs/algorand-assets.md).
//
// The search and the verified list are lib/ui/asset-picker.ts, shared with the
// x402 desk. Signing goes through the PARSEC Keycore.

import { el, btn } from '../lib/dom';
import { store } from '../lib/store';
import { assetPicker } from '../lib/ui/asset-picker';

export function addAssetView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return el('div'); }
  const network = state.settings.network;

  return el('div', {
    cls: 'parsec-view parsec-assets',
    children: [
      el('div', { cls: 'parsec-view__header', children: [
        btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
      ] }),
      el('section', { cls: 'parsec-assets__hero', children: [
        el('p', { cls: 'parsec-assets__kicker', text: `Algorand · ${network}` }),
        el('h2', { cls: 'parsec-assets__h', text: 'ADD ASSETS' }),
        el('p', { cls: 'parsec-assets__lede', text: 'An Algorand account receives an asset only after opting in to it, so nobody can drop an unwanted token into your wallet. Each opt-in sets aside 0.1 ALGO of minimum balance (returned if you remove the asset) and costs a 0.001 ALGO fee.' }),
      ] }),
      assetPicker(),
      el('p', { cls: 'parsec-assets__note', text: 'Anyone can create an asset on Algorand with any name. The id is what identifies it: verified assets were checked against their issuers’ ids, and an asset that copies a verified name under another id is flagged.' }),
    ],
  });
}
