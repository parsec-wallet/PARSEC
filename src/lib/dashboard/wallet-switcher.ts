// Wallet switcher — the header pill + popover that lets the user pick which
// account, and which chain of that account, the dashboard is showing.
//
// Modelled on Phantom: the account is the primary unit (avatar + name), and
// the chains it holds are secondary rows under it. Switching is one click;
// each chain row also has a one-click address copy that does not switch.

import { el, btn, toast } from '../dom';
import { onCleanup } from '../lifecycle';
import { store, getAccountAddress } from '../store';
import { getChainDescriptor } from '../chains';
import { defaultAvatarFor } from '../avatars';
import type { WalletAccount } from '../../types/wallet';
import type { ChainId } from '../pouch/types';

/** Chains an account can be viewed on: every key in its `chains` map, with
 *  `algorand` guaranteed present (legacy accounts predate the chains map). */
function accountChains(account: WalletAccount): ChainId[] {
  return [...new Set<string>(['algorand', ...Object.keys(account.chains ?? {})])];
}

/** Longest account name kept; any text is allowed. */
const MAX_NAME = 40;

/** Rename an account in the open profile. The name is the participant's own
 *  label; it is never used to find or sign with a key. */
export function renameAccount(index: number, name: string): void {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!clean) return;
  const accounts = store.get().accounts.map((a, i) => (i === index ? { ...a, name: clean } : a));
  store.set({ accounts });
}

function avatarOf(account: WalletAccount): string {
  return account.avatar ?? defaultAvatarFor(account.address);
}

export function createWalletSwitcher(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const activeChain = (account?.activeChain ?? 'algorand') as ChainId;
  const desc = getChainDescriptor(activeChain);

  const root = el('div', { cls: 'parsec-wallet-switcher' });
  const popover = el('div', { cls: 'parsec-wallet-switcher__popover' });
  let open = false;

  const pill = el('div', {
    cls: 'parsec-wallet-switcher__pill',
    children: [
      el('span', { cls: 'parsec-wallet-switcher__avatar', text: account ? avatarOf(account) : '👛' }),
      el('span', { cls: 'parsec-wallet-switcher__pill-name', text: account?.name ?? 'Wallet' }),
      el('span', { cls: 'parsec-wallet-switcher__pill-chain', text: desc.label }),
      el('span', { cls: 'bp5-icon bp5-icon-caret-down' }),
    ],
    onClick: (e) => { e.stopPropagation(); setOpen(!open); },
  });

  function onDocClick(e: MouseEvent): void {
    if (!root.contains(e.target as Node)) setOpen(false);
  }

  // Single idempotent state setter — keeps `open`, the `--open` class, and the
  // outside-click listener in lockstep so pill-toggle and click-outside both
  // reliably close the popover.
  function setOpen(next: boolean): void {
    if (next === open) return;
    open = next;
    popover.classList.toggle('parsec-wallet-switcher__popover--open', open);
    if (open) {
      buildPopover();
      document.addEventListener('click', onDocClick, true);
    } else {
      document.removeEventListener('click', onDocClick, true);
    }
  }

  // Closing removes the document click listener; do it with the view, not
  // only on the next click, so a dashboard left with the popover open is
  // not held until then.
  onCleanup(() => setOpen(false));

  function copyChip(label: string, addr: string): HTMLElement {
    return el('span', {
      cls: 'parsec-wallet-switcher__chain-copy bp5-icon bp5-icon-duplicate',
      attrs: { title: `Copy ${label} address` },
      onClick: (e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(addr);
        toast(`${label} address copied`, 'success');
      },
    });
  }

  /** Swap an account's name for a field: Enter or leaving saves, Escape cancels. */
  function startRename(index: number, nameSpan: HTMLElement): void {
    const current = store.get().accounts[index]?.name ?? '';
    const field = document.createElement('input');
    field.className = 'parsec-wallet-switcher__rename-field';
    field.value = current;
    field.maxLength = MAX_NAME;
    field.setAttribute('aria-label', 'Account name');
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const next = field.value.trim();
      if (save && next && next !== current) {
        renameAccount(index, next);
        toast(`Renamed to “${next}”`, 'success');
      }
      buildPopover();
      pill.querySelector('.parsec-wallet-switcher__pill-name')!.textContent =
        store.get().accounts[store.get().activeAccountIndex]?.name ?? 'Wallet';
    };
    field.addEventListener('click', (e) => e.stopPropagation());
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    field.addEventListener('blur', () => finish(true));
    nameSpan.replaceWith(field);
    field.focus();
    field.select();
  }

  function buildPopover(): void {
    popover.innerHTML = '';
    const s = store.get();
    s.accounts.forEach((acct, i) => {
      const isActiveAccount = i === s.activeAccountIndex;
      const acctChain = (acct.activeChain ?? 'algorand') as ChainId;

      const nameSpan = el('span', { cls: 'parsec-wallet-switcher__account-name', text: acct.name });
      const row = el('div', {
        cls: `parsec-wallet-switcher__account${isActiveAccount ? ' parsec-wallet-switcher__account--active' : ''}`,
        children: [
          el('span', { cls: 'parsec-wallet-switcher__avatar', text: avatarOf(acct) }),
          nameSpan,
          el('button', {
            cls: 'parsec-wallet-switcher__rename',
            text: '✎',
            attrs: { type: 'button', title: 'Rename this account', 'aria-label': `Rename ${acct.name}` },
            onClick: (e) => { e.stopPropagation(); startRename(i, nameSpan); },
          }),
        ],
        onClick: () => { setOpen(false); store.selectChain(i, acctChain); },
      });
      popover.appendChild(row);

      for (const chainId of accountChains(acct)) {
        const addr = getAccountAddress(acct, chainId);
        if (!addr) continue;
        const cd = getChainDescriptor(chainId);
        const isActive = isActiveAccount && acctChain === chainId;
        popover.appendChild(el('div', {
          cls: `parsec-wallet-switcher__chain${isActive ? ' parsec-wallet-switcher__chain--active' : ''}`,
          children: [
            el('span', { cls: 'parsec-wallet-switcher__chain-label', text: cd.label }),
            el('span', { cls: 'parsec-wallet-switcher__chain-addr', text: cd.truncate(addr) }),
            copyChip(cd.label, addr),
          ],
          onClick: () => { setOpen(false); store.selectChain(i, chainId); },
        }));
      }
    });
    popover.appendChild(el('div', {
      cls: 'parsec-wallet-switcher__footer',
      children: [
        btn('Add wallet', { minimal: true, icon: 'plus', onClick: () => { setOpen(false); store.navigate('create-wallet'); } }),
        btn('Import', { minimal: true, icon: 'import', onClick: () => { setOpen(false); store.navigate('import-wallet'); } }),
      ],
    }));
  }

  root.append(pill, popover);
  return root;
}
