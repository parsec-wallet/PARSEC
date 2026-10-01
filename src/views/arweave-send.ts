// Arweave send — transfer AR from the active account's Arweave (HD) address.
// The JWK is retrieved from the BANKON vault only at sign time; transferAr
// signs with WebCrypto RSA-PSS and zeroes the JWK's private fields after.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { getArBalance, arToWinston } from '../lib/arweave/client';
import { transferAr } from '../lib/arweave/tx';

const AR_ADDRESS = /^[A-Za-z0-9_-]{43}$/;

export function arweaveSendView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const from = account ? getAccountAddress(account, 'arweave-hd') : undefined;

  if (!account || !from) {
    store.navigate('dashboard');
    return el('div');
  }

  let recipient = '';
  let amount = '';
  let busy = false;

  const balanceEl = el('div', { cls: 'parsec-send__balance', text: 'Balance: …' });
  getArBalance(from)
    .then((ar) => { balanceEl.textContent = `Balance: ${Number(ar).toLocaleString(undefined, { maximumFractionDigits: 6 })} AR`; })
    .catch(() => { balanceEl.textContent = 'Balance unavailable'; });

  const submit = btn('Send AR', {
    intent: 'primary', large: true, cls: 'parsec-send__submit',
    onClick: () => { void run(); },
  });

  async function run(): Promise<void> {
    if (busy) return;
    const to = recipient.trim();
    const amt = Number(amount);
    if (!AR_ADDRESS.test(to)) { toast('Invalid Arweave recipient address', 'danger'); return; }
    if (!(amt > 0)) { toast('Enter an amount greater than zero', 'danger'); return; }
    if (!confirm(`Send ${amt} AR to ${to}?`)) return;

    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Wallet is locked', 'danger'); store.navigate('unlock'); return; }

    busy = true;
    submit.disabled = true;
    try {
      const receipt = await transferAr(from!, passphrase, to, arToWinston(String(amt)));
      toast(`Sent — tx ${receipt.id.slice(0, 12)}…`, 'success');
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
        el('h2', { cls: 'parsec-view__title', text: 'Send AR' }),
      ]}),
      balanceEl,
      el('div', { cls: 'parsec-send__form', children: [
        el('label', { cls: 'parsec-label', text: 'To' }),
        input({ placeholder: 'Arweave recipient address', cls: 'bp5-input bp5-large bp5-fill parsec-send__input', onInput: (v) => { recipient = v; } }),
        el('label', { cls: 'parsec-label', text: 'Amount (AR)' }),
        input({ type: 'number', placeholder: '0.0', cls: 'bp5-input bp5-large bp5-fill parsec-send__input', onInput: (v) => { amount = v; } }),
      ]}),
      submit,
    ],
  });
}
