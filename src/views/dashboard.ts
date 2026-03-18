// Parsec Wallet — Dashboard View

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { fetchAccountInfo, microAlgosToAlgo } from '../lib/algorand/account';
import { fetchTransactions } from '../lib/algorand/transactions';
import { enrichAssets, formatAssetAmount, optOutFromAsset, lookupAsset } from '../lib/algorand/assets';
import { keystoreRetrieve } from '../lib/keystore';
import type { AccountInfo, TransactionRecord, NetworkId } from '../types/wallet';

export function dashboardView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return el('div'); }

  const container = el('div', { cls: 'parsec-view parsec-dashboard' });

  // Header
  const header = el('div', {
    cls: 'parsec-dashboard__header',
    children: [
      el('div', { cls: 'parsec-logo parsec-logo--small', text: 'PARSEC' }),
      el('div', {
        cls: 'parsec-dashboard__nav',
        children: [
          btn('', { minimal: true, icon: 'help', onClick: () => store.navigate('docs') }),
          btn('', { minimal: true, icon: 'lock', onClick: () => store.lock() }),
          btn('', { minimal: true, icon: 'cog', onClick: () => store.navigate('settings') }),
        ],
      }),
    ],
  });

  // Public Receive Key
  const addr = account.address;
  const keyText = el('span', { cls: 'parsec-pubkey__text', text: `${addr.slice(0, 6)} ···· ${addr.slice(-6)}` });
  const keyValue = el('div', {
    cls: 'parsec-dashboard__pubkey-value',
    attrs: { title: 'Click to copy' },
    children: [keyText],
    onClick: () => { navigator.clipboard.writeText(addr); toast('Public receive key copied', 'success'); },
  });
  keyValue.addEventListener('mouseenter', () => { keyText.textContent = addr; keyValue.classList.add('parsec-pubkey--expanded'); });
  keyValue.addEventListener('mouseleave', () => { keyText.textContent = `${addr.slice(0, 6)} ···· ${addr.slice(-6)}`; keyValue.classList.remove('parsec-pubkey--expanded'); });

  const publicKey = el('div', {
    cls: 'parsec-dashboard__pubkey',
    children: [
      el('div', { cls: 'parsec-dashboard__pubkey-label', text: 'Public Receive Key' }),
      keyValue,
    ],
  });

  // Network badge
  const network = state.settings.network;
  const networkBadge = el('div', { cls: `parsec-network-badge parsec-network-badge--${network}`, text: network.toUpperCase() });

  // Testnet faucet
  const faucetLink = network === 'testnet'
    ? el('a', {
        cls: 'parsec-faucet-link',
        text: 'Get testnet ALGO from faucet',
        attrs: { href: 'https://bank.testnet.algorand.network/', target: '_blank', rel: 'noopener' },
      })
    : null;

  // Balance
  const balanceEl = el('div', {
    cls: 'parsec-dashboard__balance',
    children: [
      el('div', { cls: 'parsec-dashboard__balance-label', text: 'Total Balance' }),
      el('div', { cls: 'parsec-dashboard__balance-value', text: '...' }),
      el('div', { cls: 'parsec-dashboard__balance-min', text: '' }),
      el('div', { cls: 'parsec-dashboard__balance-rewards', text: '' }),
    ],
  });

  // Actions — participant choices after signature-based login
  const actions = el('div', {
    cls: 'parsec-dashboard__actions',
    children: [
      btn('Send', { intent: 'primary', icon: 'arrow-top-right', onClick: () => store.navigate('send') }),
      btn('Swap', { intent: 'warning', icon: 'swap-horizontal', onClick: () => store.navigate('swap') }),
      btn('Receive', { intent: 'success', icon: 'arrow-bottom-left', onClick: () => store.navigate('receive') }),
    ],
  });

  const assetsEl = el('div', { cls: 'parsec-dashboard__assets' });
  const addAssetBtn = btn('Add Asset', { outlined: true, icon: 'plus', cls: 'parsec-dashboard__add-asset', onClick: () => store.navigate('add-asset') });
  const txHeader = el('h3', { cls: 'parsec-section-title', text: 'Recent Transactions' });
  const txList = el('div', { cls: 'parsec-dashboard__transactions' });

  const children = [header, publicKey, networkBadge];
  if (faucetLink) children.push(faucetLink);
  children.push(balanceEl, actions, assetsEl, addAssetBtn, txHeader, txList);
  container.append(...children);

  loadDashboardData(account.address, network, balanceEl, assetsEl, txList);
  return container;
}

async function loadDashboardData(address: string, network: NetworkId, balanceEl: HTMLElement, assetsEl: HTMLElement, txList: HTMLElement): Promise<void> {
  try {
    const [info, txs] = await Promise.all([
      fetchAccountInfo(address, network),
      fetchTransactions(address, network),
    ]);
    info.assets = await enrichAssets(info.assets, network);
    store.set({ accountInfo: info, transactions: txs });
    renderBalance(balanceEl, info);
    renderAssets(assetsEl, info, address, network);
    renderTransactions(txList, txs, address, info);
  } catch (err) {
    toast(`Failed to load: ${err instanceof Error ? err.message : 'Network error'}`, 'danger');
    txList.innerHTML = '';
    txList.appendChild(btn('Retry', { outlined: true, onClick: () => loadDashboardData(address, network, balanceEl, assetsEl, txList) }));
  }
}

function renderBalance(container: HTMLElement, info: AccountInfo): void {
  const val = container.querySelector('.parsec-dashboard__balance-value');
  if (val) val.textContent = `${microAlgosToAlgo(info.amount)} ALGO`;

  const min = container.querySelector('.parsec-dashboard__balance-min');
  if (min) min.textContent = `Min Balance: ${microAlgosToAlgo(info.minBalance)} ALGO`;

  const rewards = container.querySelector('.parsec-dashboard__balance-rewards');
  if (rewards && info.pendingRewards > 0) {
    rewards.textContent = `Pending Rewards: ${microAlgosToAlgo(info.pendingRewards)} ALGO`;
  }
}

function renderAssets(container: HTMLElement, info: AccountInfo, userAddress: string, network: NetworkId): void {
  container.innerHTML = '';
  container.appendChild(el('h3', { cls: 'parsec-section-title', text: 'Assets' }));

  // ALGO first
  container.appendChild(el('div', {
    cls: 'parsec-asset-row',
    children: [
      el('span', { cls: 'parsec-asset-row__name', text: 'ALGO' }),
      el('span', { cls: 'parsec-asset-row__amount', text: microAlgosToAlgo(info.amount) }),
    ],
  }));

  // ASAs
  for (const asset of info.assets) {
    const badges: HTMLElement[] = [];
    if (asset.isFrozen) badges.push(el('span', { cls: 'parsec-badge parsec-badge--danger', text: 'Frozen' }));
    if (asset.hasFreezeAddr) badges.push(el('span', { cls: 'parsec-badge parsec-badge--warn', text: 'Freezable' }));
    if (asset.hasClawbackAddr) badges.push(el('span', { cls: 'parsec-badge parsec-badge--warn', text: 'Clawback' }));

    const canOptOut = asset.amount === 0 && !asset.isFrozen;

    const rowChildren: HTMLElement[] = [
      el('div', {
        cls: 'parsec-asset-row__info',
        children: [
          el('span', { cls: 'parsec-asset-row__name', text: asset.unitName || asset.name || `ASA #${asset.assetId}` }),
          badges.length > 0 ? el('div', { cls: 'parsec-asset-row__badges', children: badges }) : el('span'),
        ],
      }),
      el('div', {
        cls: 'parsec-asset-row__right',
        children: [
          el('span', { cls: 'parsec-asset-row__amount', text: formatAssetAmount(asset.amount, asset.decimals) }),
          canOptOut ? btn('Remove', {
            minimal: true, intent: 'danger',
            onClick: async () => {
              if (!confirm(`Remove ${asset.unitName || `ASA #${asset.assetId}`}? This recovers 0.1 ALGO min balance.`)) return;
              const passphrase = store.getPassphrase();
              if (!passphrase) { toast('Session expired.', 'danger'); store.navigate('unlock'); return; }
              const mnemonic = await keystoreRetrieve(userAddress, passphrase);
              if (!mnemonic) { toast('Could not retrieve key.', 'danger'); return; }

              try {
                const assetInfo = await lookupAsset(asset.assetId, network);
                const creator = assetInfo?.creator || userAddress;
                await optOutFromAsset(mnemonic, asset.assetId, creator, network);
                store.set({ accountInfo: null });
                toast(`Removed ${asset.unitName || `ASA #${asset.assetId}`}`, 'success');
                store.navigate('dashboard');
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Opt-out failed', 'danger');
              }
            },
          }) : el('span'),
        ],
      }),
    ];

    container.appendChild(el('div', { cls: 'parsec-asset-row', children: rowChildren }));
  }
}

function renderTransactions(container: HTMLElement, txs: TransactionRecord[], myAddress: string, info: AccountInfo): void {
  container.innerHTML = '';
  if (txs.length === 0) { container.appendChild(el('div', { cls: 'parsec-empty', text: 'No transactions yet.' })); return; }

  for (const tx of txs) {
    const isSent = tx.sender === myAddress;
    const counterparty = isSent ? (tx.receiver || '—') : tx.sender;
    const sign = isSent ? '-' : '+';

    let amountText: string, unit: string;
    if (tx.type === 'axfer' && tx.assetId) {
      const asset = info.assets.find(a => a.assetId === tx.assetId);
      amountText = formatAssetAmount(tx.amount, asset?.decimals);
      unit = asset?.unitName || `ASA#${tx.assetId}`;
    } else if (tx.type === 'pay') {
      amountText = microAlgosToAlgo(tx.amount, 4);
      unit = 'ALGO';
    } else {
      amountText = '';
      unit = tx.type.toUpperCase();
    }

    const date = tx.roundTime ? new Date(tx.roundTime * 1000).toLocaleDateString() : '—';
    container.appendChild(el('div', {
      cls: `parsec-tx-row parsec-tx-row--${isSent ? 'sent' : 'received'}`,
      children: [
        el('div', {
          cls: 'parsec-tx-row__info',
          children: [
            el('span', { cls: 'parsec-tx-row__type', text: isSent ? 'Sent' : 'Received' }),
            el('span', { cls: 'parsec-tx-row__address', text: `${counterparty.slice(0, 6)}...${counterparty.slice(-4)}` }),
            el('span', { cls: 'parsec-tx-row__date', text: date }),
          ],
        }),
        el('div', { cls: 'parsec-tx-row__amount', text: amountText ? `${sign}${amountText} ${unit}` : unit }),
      ],
    }));
  }
}
