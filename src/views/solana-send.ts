// Solana send — transfer SOL from the active account's Solana address.
// The mnemonic is retrieved from the BANKON vault only at sign time and
// discarded immediately after (sendSol zeroes the derived secret seed).

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { keystoreRetrieve } from '../lib/keystore';
import { isSolanaAddress } from '../lib/solana/address';
import { fetchSolBalance } from '../lib/solana/balance';
import { sendSol } from '../lib/solana/transfer';

export function solanaSendView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const from = account ? getAccountAddress(account, 'solana') : undefined;

  if (!account || !from) {
    store.navigate('dashboard');
    return el('div');
  }

  let recipient = '';
  let amount = '';
  let busy = false;

  const balanceEl = el('div', { cls: 'parsec-send__balance', text: 'Balance: …' });
  fetchSolBalance(from)
    .then((b) => { balanceEl.textContent = `Balance: ${b.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`; })
    .catch(() => { balanceEl.textContent = 'Balance unavailable'; });

  const submit = btn('Send SOL', {
    intent: 'primary', large: true, cls: 'parsec-send__submit',
    onClick: () => { void run(); },
  });

  async function run(): Promise<void> {
    if (busy) return;
    const to = recipient.trim();
    const amt = Number(amount);
    if (!isSolanaAddress(to)) { toast('Invalid Solana recipient address', 'danger'); return; }
    if (!(amt > 0)) { toast('Enter an amount greater than zero', 'danger'); return; }
    if (!confirm(`Send ${amt} SOL to ${to}?`)) return;

    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Wallet is locked', 'danger'); store.navigate('unlock'); return; }

    busy = true;
    submit.disabled = true;
    try {
      const mnemonic = await keystoreRetrieve(from!, passphrase);
      if (!mnemonic) throw new Error('No Solana key in vault for this account');
      const sig = await sendSol(mnemonic, to, amt);
      toast(`Sent — signature ${sig.slice(0, 12)}…`, 'success');
      store.navigate('dashboard');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Send failed', 'danger');
      busy = false;
      submit.disabled = false;
    }
  }

  return el('div', {
    cls: 'parsec-view parsec-send',
    children: [
      el('div', { cls: 'parsec-view__header', children: [
        btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
        el('h2', { cls: 'parsec-view__title', text: 'Send SOL' }),
      ]}),
      balanceEl,
      el('div', { cls: 'parsec-send__form', children: [
        el('label', { cls: 'parsec-label', text: 'To' }),
        input({ placeholder: 'Solana recipient address', cls: 'bp5-input bp5-large bp5-fill parsec-send__input', onInput: (v) => { recipient = v; } }),
        el('label', { cls: 'parsec-label', text: 'Amount (SOL)' }),
        input({ type: 'number', placeholder: '0.0', cls: 'bp5-input bp5-large bp5-fill parsec-send__input', onInput: (v) => { amount = v; } }),
      ]}),
      submit,
    ],
  });
}
