// Wallet switcher — the header pill + popover that lets the user pick which
// account, and which chain of that account, the dashboard is showing.
//
// Modelled on Phantom: the account is the primary unit (avatar + name), and
// the chains it holds are secondary rows under it. Switching is one click;
// each chain row also has a one-click address copy that does not switch.

import { el, btn, toast } from '../dom';
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

  function buildPopover(): void {
    popover.innerHTML = '';
    const s = store.get();
    s.accounts.forEach((acct, i) => {
      const isActiveAccount = i === s.activeAccountIndex;
      const acctChain = (acct.activeChain ?? 'algorand') as ChainId;

      popover.appendChild(el('div', {
        cls: `parsec-wallet-switcher__account${isActiveAccount ? ' parsec-wallet-switcher__account--active' : ''}`,
        children: [
          el('span', { cls: 'parsec-wallet-switcher__avatar', text: avatarOf(acct) }),
          el('span', { cls: 'parsec-wallet-switcher__account-name', text: acct.name }),
        ],
        onClick: () => { setOpen(false); store.selectChain(i, acctChain); },
      }));

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
