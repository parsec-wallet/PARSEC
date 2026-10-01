// Transfer ARIO tokens to another address.
//
// Mirror of bankon-transfer-style flow if/when we ship a BANKON token. For
// now this only handles ARIO (the AR.IO Network token). The wallet signs a
// DataItem with `Action: Transfer` against the AR.IO mainnet process and
// the network applies the balance change.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  buildTransferArioInput,
  formatArio,
  getArioBalance,
  MARIO_PER_ARIO,
  parseArio,
} from '../lib/arweave/ario';
import { signDataItemFromVault } from '../lib/arweave/ans104';
import { aoMessage } from '../lib/arweave/ao';

export function arioTransferView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm' });

  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const address = account
    ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave'))
    : undefined;

  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', {
        minimal: true,
        icon: 'arrow-left',
        onClick: () => store.navigate('ario-hub'),
      }),
      el('h2', { cls: 'parsec-view__title', text: 'Transfer ARIO' }),
    ],
  }));

  if (!address) {
    root.appendChild(el('div', {
      cls: 'parsec-callout bp5-callout bp5-intent-warning',
      children: [
        el('p', { text: 'No Arweave address on the active account.' }),
        btn('Create Arweave', { intent: 'primary', onClick: () => store.navigate('arweave-create') }),
      ],
    }));
    return root;
  }

  let balance = 0n;
  let recipient = '';
  let amountStr = '';
  let busy = false;

  const balanceEl = el('span', { cls: 'parsec-confirm__value', text: 'loading...' });
  const recipientInput = input({
    placeholder: 'Recipient (43-char Arweave address)',
    cls: 'bp5-input bp5-fill',
    onInput: (v) => { recipient = v.trim(); },
  });
  const amountInput = input({
    placeholder: 'amount (ARIO; up to 6 decimal places)',
    cls: 'bp5-input bp5-fill',
    onInput: (v) => { amountStr = v.trim(); },
  });

  const statusEl = el('p', { cls: 'parsec-confirm__value', text: '' });

  function refreshBalance(): void {
    balanceEl.textContent = 'loading...';
    void getArioBalance(address!)
      .then((b) => { balance = b; balanceEl.textContent = `${formatArio(b)} ARIO`; })
      .catch(() => { balanceEl.textContent = '— (unreachable)'; });
  }
  refreshBalance();

  root.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      row('Sender', truncAddr(address)),
      row('Balance', balanceEl),
      btn('Refresh', { minimal: true, icon: 'refresh', onClick: refreshBalance }),
      el('label', { text: 'Recipient' }),
      recipientInput,
      el('label', { text: 'Amount' }),
      amountInput,
      statusEl,
    ],
  }));

  root.appendChild(el('div', {
    cls: 'parsec-confirm__actions',
    children: [
      btn('Cancel', {
        outlined: true,
        large: true,
        onClick: () => store.navigate('ario-hub'),
      }),
      btn('Sign & send', {
        intent: 'primary',
        large: true,
        icon: 'send-message',
        onClick: async () => {
          if (busy) return;
          if (recipient.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(recipient)) {
            toast('Recipient must be a 43-char Arweave address', 'warning');
            return;
          }
          let quantity: bigint;
          try {
            quantity = parseArio(amountStr);
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Invalid amount', 'warning');
            return;
          }
          if (quantity <= 0n) { toast('Amount must be greater than 0', 'warning'); return; }
          if (quantity > balance) { toast('Insufficient balance', 'warning'); return; }

          const passphrase = store.getPassphrase();
          if (!passphrase) {
            toast('Wallet is locked', 'danger');
            store.navigate('unlock');
            return;
          }

          busy = true;
          statusEl.textContent = 'Signing...';
          try {
            const signed = await signDataItemFromVault(
              address!,
              passphrase,
              buildTransferArioInput({ recipient, quantity }),
            );
            statusEl.textContent = `Posting (id=${signed.id})...`;
            await aoMessage(signed);
            toast(`Sent ${formatArio(quantity)} ARIO (${quantity.toString()} mARIO; 1 ARIO = ${MARIO_PER_ARIO.toString()} mARIO)`, 'success');
            statusEl.textContent = `Done. Message id: ${signed.id}`;
            // Optimistically update local balance pending the on-chain settle.
            balance -= quantity;
            balanceEl.textContent = `${formatArio(balance)} ARIO`;
          } catch (e) {
            statusEl.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
            toast('Transfer failed', 'danger');
          } finally {
            busy = false;
          }
        },
      }),
    ],
  }));

  return root;
}

function row(label: string, value: string | HTMLElement): HTMLElement {
  const valueNode = typeof value === 'string'
    ? el('span', { cls: 'parsec-confirm__value', text: value })
    : value;
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [el('span', { cls: 'parsec-confirm__label', text: label }), valueNode],
  });
}

function truncAddr(a: string): string {
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}
