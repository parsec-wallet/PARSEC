// Arweave dApp Connection Approval — shown when window.arweaveWallet.connect()
// is called from a dApp page. Mirrors connect-approve.ts but for the
// permission grant rather than a per-tx sign request.

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  getPendingArweaveApproval,
  rejectArweaveApproval,
  resolveArweaveApproval,
  type ArweavePermission,
} from '../lib/arweave/inject';

const PERMISSION_DESCRIPTIONS: Record<ArweavePermission, string> = {
  ACCESS_ADDRESS: 'See your active Arweave address',
  ACCESS_PUBLIC_KEY: 'See your active public key',
  ACCESS_ALL_ADDRESSES: 'See all your Arweave addresses',
  SIGN_TRANSACTION: 'Sign Arweave transactions (vault prompt per signature)',
  ENCRYPT: 'Encrypt data with your key',
  DECRYPT: 'Decrypt data addressed to your key',
  SIGNATURE: 'Sign DataItems and arbitrary messages',
  ACCESS_ARWEAVE_CONFIG: 'See the gateway PARSEC is using',
  DISPATCH: 'Dispatch (sign + post) transactions to the network',
};

export function arweaveApproveView(): HTMLElement {
  const req = getPendingArweaveApproval();
  if (!req) {
    return el('div', {
      cls: 'parsec-view parsec-confirm',
      children: [
        el('p', { cls: 'parsec-empty', text: 'No pending Arweave approval.' }),
        btn('Back to Dashboard', {
          intent: 'primary',
          onClick: () => store.navigate('dashboard'),
        }),
      ],
    });
  }

  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const address = account
    ? (getAccountAddress(account, 'arweave') ?? getAccountAddress(account, 'arweave-hd'))
    : undefined;

  return el('div', {
    cls: 'parsec-view parsec-confirm',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Reject', {
            minimal: true,
            icon: 'arrow-left',
            onClick: () => handleReject(),
          }),
          el('h2', { cls: 'parsec-view__title', text: 'Arweave Connect Request' }),
        ],
      }),

      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-primary',
        children: [
          el('p', {
            text: `${req.origin} is requesting access to your Arweave wallet.`,
          }),
          req.appInfo?.name
            ? el('p', { text: `App: ${req.appInfo.name}` })
            : el('span', {}),
        ],
      }),

      el('div', {
        cls: 'parsec-confirm__details',
        children: [
          row('Origin', req.origin),
          address ? row('Signing As', truncAddr(address)) : null,
          row('Requested At', new Date(req.createdAt).toLocaleTimeString()),
        ].filter(Boolean) as HTMLElement[],
      }),

      el('div', {
        cls: 'parsec-confirm__details',
        children: [
          el('h4', { text: 'Requested permissions' }),
          ...req.permissions.map((p) =>
            el('div', {
              cls: 'parsec-confirm__row',
              children: [
                el('span', { cls: 'parsec-confirm__label', text: p }),
                el('span', { cls: 'parsec-confirm__value', text: PERMISSION_DESCRIPTIONS[p] ?? 'Custom permission' }),
              ],
            }),
          ),
        ],
      }),

      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        children: [
          el('p', {
            text: 'PARSEC will keep your Arweave key in the BANKON vault. The dApp never sees the key — every signature passes through this approval flow.',
          }),
        ],
      }),

      el('div', {
        cls: 'parsec-confirm__actions',
        children: [
          btn('Reject', {
            large: true,
            outlined: true,
            onClick: () => handleReject(),
          }),
          btn('Approve', {
            intent: 'primary',
            large: true,
            disabled: !address,
            onClick: () => handleApprove(req.permissions),
          }),
        ],
      }),
    ],
  });
}

function handleApprove(perms: ArweavePermission[]): void {
  resolveArweaveApproval(perms);
  toast('dApp connected', 'success');
  store.navigate('dashboard');
}

function handleReject(): void {
  rejectArweaveApproval('User rejected');
  toast('Connection rejected', 'primary');
  store.navigate('dashboard');
}

function row(label: string, value: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [
      el('span', { cls: 'parsec-confirm__label', text: label }),
      el('span', { cls: 'parsec-confirm__value', text: value }),
    ],
  });
}

function truncAddr(a: string): string {
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}
