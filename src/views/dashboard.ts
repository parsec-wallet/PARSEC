// Parsec Wallet — Dashboard View

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { listDashboardModules } from '../lib/dashboard';
import { createWalletSwitcher } from '../lib/dashboard/wallet-switcher';
import { getChainDescriptor } from '../lib/chains';
import type { ChainId } from '../lib/pouch/types';
import type { DashboardContext } from '../lib/dashboard-modules';
import { fetchAccountInfo, microAlgosToAlgo } from '../lib/algorand/account';
import { fetchTransactions } from '../lib/algorand/transactions';
import { enrichAssets, formatAssetAmount, optOutFromAsset, lookupAsset } from '../lib/algorand/assets';
import { resolveIpfsUrl } from '../lib/algorand/ipfs-gateway';
import { resolveAddress, searchByOwner } from '../lib/nfd';
import { keystoreRetrieve } from '../lib/keystore';
import { formatPrice, fetchPrices, fetchPricesByIds } from '../lib/prices';
import type { CoinPrice } from '../lib/prices';
import type { AccountInfo, TransactionRecord, NetworkId, WalletAccount } from '../types/wallet';

export function dashboardView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return el('div'); }

  const container = el('div', { cls: 'parsec-view parsec-dashboard' });

  // Which chain this account is being viewed on — drives the price tag,
  // the panel below, and (via the router) re-render on a chain switch.
  const activeChain = (account.activeChain ?? 'algorand') as ChainId;

  // Header — PARSEC + price for the active chain's native asset.
  const priceTag = el('span', { cls: 'parsec-dashboard__price-tag', text: '$...' });
  const priceCoinId = getChainDescriptor(activeChain).priceId ?? 'algorand';

  function updatePriceTag(coinPrices: CoinPrice[]) {
    const coin = coinPrices.find(p => p.id === priceCoinId);
    if (coin) {
      const sign = coin.change24h >= 0 ? '+' : '';
      const changeCls = coin.change24h >= 0 ? 'parsec-dashboard__change--up' : 'parsec-dashboard__change--down';
      priceTag.textContent = '';
      priceTag.appendChild(document.createTextNode(`${coin.symbol} ${formatPrice(coin.usd)} `));
      const changeSpan = document.createElement('span');
      changeSpan.className = `parsec-dashboard__change ${changeCls}`;
      changeSpan.textContent = `${sign}${coin.change24h.toFixed(1)}%`;
      priceTag.appendChild(changeSpan);
    } else {
      priceTag.textContent = '$';
    }
  }

  // Fetch by explicit id — Arweave can sit outside the top-100 markets list.
  fetchPricesByIds([priceCoinId]).then(updatePriceTag);

  const header = el('div', {
    cls: 'parsec-dashboard__header',
    children: [
      el('div', { cls: 'parsec-dashboard__brand-row', children: [
        el('div', { cls: 'parsec-logo parsec-logo--small', text: 'PARSEC' }),
        priceTag,
      ]}),
      createWalletSwitcher(),
      el('div', {
        cls: 'parsec-dashboard__nav',
        children: [
          btn('', { minimal: true, icon: 'help', onClick: () => store.navigate('docs') }),
          btn('Logout', {
            minimal: true, icon: 'log-out', cls: 'parsec-dashboard__logout',
            onClick: () => {
              // Visual confirmation before clearing
              const confirmed = confirm('Lock wallet and clear session?\n\nYour passphrase and all sensitive data will be wiped from memory. You will need your passphrase to re-enter.');
              if (confirmed) {
                store.lock();
                toast('Session cleared. No trace.', 'success');
              }
            },
          }),
          btn('', { minimal: true, icon: 'cog', onClick: () => store.navigate('settings') }),
        ],
      }),
    ],
  });

  // Non-Algorand chains render a focused per-chain wallet panel. Algorand
  // keeps the full dashboard below (balance + assets + transactions + modules).
  if (activeChain !== 'algorand') {
    container.append(header, renderChainPanel(account, activeChain));
    return container;
  }

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

  // Primary .algo name — a quiet mark of identity above the raw key. Shown
  // only when the address actually carries one; clicking it copies the name.
  const nfdLine = el('div', {
    cls: 'parsec-pubkey__nfd',
    attrs: { hidden: 'true', title: 'Your .algo name — click to copy' },
  });

  const publicKey = el('div', {
    cls: 'parsec-dashboard__pubkey',
    children: [
      el('div', { cls: 'parsec-dashboard__pubkey-label', text: 'Public Receive Key' }),
      nfdLine,
      keyValue,
    ],
  });

  // Network badge
  const network = state.settings.network;
  const networkBadge = el('div', { cls: `parsec-network-badge parsec-network-badge--${network}`, text: network.toUpperCase() });

  // Recognize the wallet's .algo name and reveal the identity line. Primary
  // reverse-resolution first; if the address owns a name without a primary
  // reverse record, fall back to its owned name so it is still recognized.
  void (async () => {
    try {
      let algoName = (await resolveAddress(network, addr))?.name ?? null;
      if (!algoName) {
        const owned = await searchByOwner(network, addr, { limit: 1, view: 'brief' });
        algoName = owned.nfds[0]?.name ?? null;
      }
      if (!algoName) return;
      const name = algoName;
      nfdLine.innerHTML = '';
      nfdLine.append(
        el('span', { cls: 'parsec-pubkey__nfd-mark', text: '◆' }),
        el('span', { cls: 'parsec-pubkey__nfd-name', text: name }),
      );
      nfdLine.removeAttribute('hidden');
      nfdLine.addEventListener('click', () => {
        navigator.clipboard.writeText(name);
        toast('.algo name copied', 'success');
      });
    } catch { /* no NFD / offline — the line stays hidden */ }
  })();

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

  // Action rows are now produced by registered DashboardModules. Adding a
  // chain pack or domain pack contributes a new row without editing this
  // file — see src/lib/dashboard/*.ts for the built-ins.
  const ctx: DashboardContext = {
    account,
    getChainAddress: (chainId: string) => getAccountAddress(account, chainId),
    network,
    navigate: (view: string) => store.navigate(view as Parameters<typeof store.navigate>[0]),
    refresh: () => loadDashboardData(account.address, network, balanceEl, assetsEl, txList),
  };
  const moduleRows: HTMLElement[] = [];
  for (const mod of listDashboardModules()) {
    const row = mod.render(ctx);
    if (row) moduleRows.push(row);
  }

  const assetsEl = el('div', { cls: 'parsec-dashboard__assets' });
  const addAssetBtn = btn('Add Asset', { outlined: true, icon: 'plus', cls: 'parsec-dashboard__add-asset', onClick: () => store.navigate('add-asset') });
  const txHeader = el('h3', { cls: 'parsec-section-title', text: 'Recent Transactions' });
  const txList = el('div', { cls: 'parsec-dashboard__transactions' });

  const children = [header, publicKey, networkBadge];
  if (faucetLink) children.push(faucetLink);
  children.push(balanceEl, ...moduleRows, assetsEl, addAssetBtn, txHeader, txList);
  container.append(...children);

  loadDashboardData(account.address, network, balanceEl, assetsEl, txList);
  return container;
}

// Focused per-chain wallet panel for any non-Algorand chain: address card,
// live balance, send + receive, and an explorer link. Algorand keeps the
// full dashboard; other chains get this until they grow their own surfaces.
function renderChainPanel(account: WalletAccount, chainId: ChainId): HTMLElement {
  const desc = getChainDescriptor(chainId);
  const addr = getAccountAddress(account, chainId) ?? '';

  const badge = el('div', {
    cls: 'parsec-network-badge parsec-network-badge--mainnet',
    text: `${desc.label.toUpperCase()} · MAINNET`,
  });

  // Address card — click to copy, hover to expand (mirrors the Algorand view).
  const keyText = el('span', { cls: 'parsec-pubkey__text', text: desc.truncate(addr) });
  const keyValue = el('div', {
    cls: 'parsec-dashboard__pubkey-value',
    attrs: { title: 'Click to copy' },
    children: [keyText],
    onClick: () => { navigator.clipboard.writeText(addr); toast(`${desc.label} address copied`, 'success'); },
  });
  keyValue.addEventListener('mouseenter', () => { keyText.textContent = addr; keyValue.classList.add('parsec-pubkey--expanded'); });
  keyValue.addEventListener('mouseleave', () => { keyText.textContent = desc.truncate(addr); keyValue.classList.remove('parsec-pubkey--expanded'); });
  const addressCard = el('div', {
    cls: 'parsec-dashboard__pubkey',
    children: [
      el('div', { cls: 'parsec-dashboard__pubkey-label', text: `${desc.label} Address` }),
      keyValue,
    ],
  });

  // Live balance.
  const balanceValue = el('div', { cls: 'parsec-dashboard__balance-value', text: '…' });
  const balanceEl = el('div', {
    cls: 'parsec-dashboard__balance',
    children: [
      el('div', { cls: 'parsec-dashboard__balance-label', text: 'Balance' }),
      balanceValue,
    ],
  });
  if (desc.balance) {
    desc.balance(addr)
      .then((b) => { balanceValue.textContent = b.display; })
      .catch(() => { balanceValue.textContent = 'Unavailable'; });
  } else {
    balanceValue.textContent = `— ${desc.unit}`;
  }

  const actions = el('div', {
    cls: 'parsec-chain-panel__actions',
    children: [
      btn('Send', {
        intent: 'primary', icon: 'arrow-right', disabled: !desc.sendView,
        onClick: () => { if (desc.sendView) store.navigate(desc.sendView as Parameters<typeof store.navigate>[0]); },
      }),
      btn('Receive', {
        outlined: true, icon: 'download',
        onClick: () => { navigator.clipboard.writeText(addr); toast(`${desc.label} address copied`, 'success'); },
      }),
    ],
  });

  const explorer = el('a', {
    cls: 'parsec-faucet-link',
    text: 'View on explorer',
    attrs: { href: desc.explorerUrl(addr), target: '_blank', rel: 'noopener' },
  });

  return el('div', {
    cls: 'parsec-chain-panel',
    children: [badge, addressCard, balanceEl, actions, explorer],
  });
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

  // USD value — live from price feed
  let usdEl = container.querySelector('.parsec-dashboard__balance-usd') as HTMLElement;
  if (!usdEl) {
    usdEl = document.createElement('div');
    usdEl.className = 'parsec-dashboard__balance-usd';
    usdEl.textContent = '$';
    val?.after(usdEl);
  }
  // Update USD from latest prices
  fetchPrices().then(pp => {
    const algo = pp.find(p => p.id === 'algorand');
    if (algo) {
      usdEl.textContent = `≈ $${((info.amount / 1_000_000) * algo.usd).toFixed(2)}`;
    } else {
      usdEl.textContent = '$';
    }
  });

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

  // Fetch prices for USD display on each asset
  let coinPrices: CoinPrice[] = [];
  fetchPrices().then(p => {
    coinPrices = p;
    updateAssetPrices();
  });

  // ALGO first — with price, links
  const algoUsdEl = el('span', { cls: 'parsec-asset-row__usd', text: '$' });
  container.appendChild(el('div', {
    cls: 'parsec-asset-row parsec-asset-row--clickable',
    children: [
      el('div', { cls: 'parsec-asset-row__info', children: [
        el('span', { cls: 'parsec-asset-row__name', text: 'ALGO' }),
        el('div', { cls: 'parsec-asset-row__links', children: [
          el('a', { text: 'price', cls: 'parsec-asset-link', attrs: { href: 'https://www.coingecko.com/en/coins/algorand', target: '_blank', rel: 'noopener' } }),
          el('a', { text: 'explorer', cls: 'parsec-asset-link', attrs: { href: `https://allo.info/account/${userAddress}`, target: '_blank', rel: 'noopener' } }),
          el('a', { text: 'source', cls: 'parsec-asset-link', attrs: { href: 'https://github.com/algorand', target: '_blank', rel: 'noopener' } }),
        ]}),
      ]}),
      el('div', { cls: 'parsec-asset-row__right', children: [
        el('span', { cls: 'parsec-asset-row__amount', text: microAlgosToAlgo(info.amount) }),
        algoUsdEl,
      ]}),
    ],
  }));

  function updateAssetPrices() {
    const algo = coinPrices.find(p => p.symbol === 'ALGO');
    if (algo) algoUsdEl.textContent = `≈ $${((info.amount / 1_000_000) * algo.usd).toFixed(2)}`;
  }

  // ASAs
  for (const asset of info.assets) {
    const badges: HTMLElement[] = [];
    if (asset.isFrozen) badges.push(el('span', { cls: 'parsec-badge parsec-badge--danger', text: 'Frozen' }));
    if (asset.hasFreezeAddr) badges.push(el('span', { cls: 'parsec-badge parsec-badge--warn', text: 'Freezable' }));
    if (asset.hasClawbackAddr) badges.push(el('span', { cls: 'parsec-badge parsec-badge--warn', text: 'Clawback' }));

    const canOptOut = asset.amount === 0 && !asset.isFrozen;

    // Known CoinGecko mappings for Algorand ASAs
    const asaCoinGecko: Record<number, string> = {
      31566704: 'usd-coin',     // USDC
      312769: 'tether',         // USDt
    };
    const cgSlug = asaCoinGecko[asset.assetId];

    // Links for each asset
    const links: HTMLElement[] = [
      el('a', { text: 'explorer', cls: 'parsec-asset-link', attrs: { href: `https://allo.info/asset/${asset.assetId}`, target: '_blank', rel: 'noopener' } }),
    ];
    if (cgSlug) {
      links.unshift(el('a', { text: 'price', cls: 'parsec-asset-link', attrs: { href: `https://www.coingecko.com/en/coins/${cgSlug}`, target: '_blank', rel: 'noopener' } }));
    }

    // USD value for stablecoins
    const usdValue = (asset.unitName === 'USDC' || asset.unitName === 'USDt')
      ? `≈ $${(asset.amount / Math.pow(10, asset.decimals ?? 6)).toFixed(2)}`
      : '';

    // NFT thumbnail when metadata is available
    const nftThumb = asset.nft?.image
      ? (() => {
          const urls = resolveIpfsUrl(asset.nft!.image!);
          const src = urls[0] || asset.nft!.image!;
          return el('img', {
            cls: 'parsec-asset-row__nft-thumb',
            attrs: { src, alt: asset.nft!.name || '', loading: 'lazy', width: '32', height: '32' },
          });
        })()
      : null;

    const displayName = asset.nft?.name || asset.unitName || asset.name || `ASA #${asset.assetId}`;
    const variantTag = asset.nft ? ` · ${asset.nft.arcVariant.toUpperCase()}` : '';

    const infoChildren: HTMLElement[] = [];
    if (nftThumb) infoChildren.push(nftThumb);
    infoChildren.push(
      el('span', { cls: 'parsec-asset-row__name', text: displayName }),
      badges.length > 0 ? el('div', { cls: 'parsec-asset-row__badges', children: badges }) : el('span'),
      el('div', { cls: 'parsec-asset-row__contract', text: `ASA ${asset.assetId} · Algorand${variantTag}` }),
      el('div', { cls: 'parsec-asset-row__links', children: links }),
    );

    const rowChildren: HTMLElement[] = [
      el('div', {
        cls: 'parsec-asset-row__info',
        children: infoChildren,
      }),
      el('div', {
        cls: 'parsec-asset-row__right',
        children: [
          el('span', { cls: 'parsec-asset-row__amount', text: formatAssetAmount(asset.amount, asset.decimals) }),
          usdValue ? el('span', { cls: 'parsec-asset-row__usd', text: usdValue }) : el('span'),
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

function txTypeLabel(tx: TransactionRecord, myAddress: string): { label: string; cls: string } {
  const isSent = tx.sender === myAddress;
  switch (tx.type) {
    case 'pay': return { label: isSent ? 'Sent' : 'Received', cls: isSent ? 'sent' : 'received' };
    case 'axfer':
      if (tx.sender === tx.receiver) return { label: 'Opt-In', cls: 'neutral' };
      return { label: isSent ? 'ASA Sent' : 'ASA Received', cls: isSent ? 'sent' : 'received' };
    case 'appl':
      if (tx.createdAppId) return { label: 'Deploy', cls: 'deploy' };
      return { label: 'App Call', cls: 'appcall' };
    case 'acfg':
      if (tx.createdAssetId) return { label: 'Create ASA', cls: 'deploy' };
      return { label: 'ASA Config', cls: 'neutral' };
    case 'afrz': return { label: 'Freeze', cls: 'neutral' };
    case 'keyreg': return { label: 'Key Reg', cls: 'neutral' };
    default: return { label: String(tx.type).toUpperCase(), cls: 'neutral' };
  }
}

function explorerUrl(txId: string, network: string): string {
  if (network === 'testnet') return `https://testnet.explorer.perawallet.app/tx/${txId}`;
  if (network === 'betanet') return `https://betanet.explorer.perawallet.app/tx/${txId}`;
  return `https://explorer.perawallet.app/tx/${txId}`;
}

function appExplorerUrl(appId: number, network: string): string {
  if (network === 'testnet') return `https://testnet.explorer.perawallet.app/application/${appId}`;
  return `https://explorer.perawallet.app/application/${appId}`;
}

function assetExplorerUrl(assetId: number, network: string): string {
  if (network === 'testnet') return `https://testnet.explorer.perawallet.app/asset/${assetId}`;
  return `https://explorer.perawallet.app/asset/${assetId}`;
}

function renderTransactions(container: HTMLElement, txs: TransactionRecord[], myAddress: string, info: AccountInfo): void {
  container.innerHTML = '';
  if (txs.length === 0) { container.appendChild(el('div', { cls: 'parsec-empty', text: 'No transactions yet.' })); return; }

  const network = store.get().settings.network;

  for (const tx of txs) {
    const isSent = tx.sender === myAddress;
    const { label, cls: typeCls } = txTypeLabel(tx, myAddress);

    // Counterparty
    let counterparty = isSent ? (tx.receiver || '—') : tx.sender;
    if (tx.type === 'appl' && tx.appId) counterparty = `App #${tx.appId}`;
    if (tx.type === 'acfg' && tx.createdAssetId) counterparty = `ASA #${tx.createdAssetId}`;
    const counterpartyShort = counterparty.length > 12 ? `${counterparty.slice(0, 6)}...${counterparty.slice(-4)}` : counterparty;

    // Amount display
    let amountText = '';
    let unit = '';
    const sign = isSent ? '-' : '+';
    if (tx.type === 'axfer' && tx.assetId) {
      const asset = info.assets.find(a => a.assetId === tx.assetId);
      amountText = formatAssetAmount(tx.amount, asset?.decimals);
      unit = asset?.unitName || `ASA#${tx.assetId}`;
    } else if (tx.type === 'pay' && tx.amount > 0) {
      amountText = microAlgosToAlgo(tx.amount, 4);
      unit = 'ALGO';
    }

    // Date + time
    const date = tx.roundTime ? new Date(tx.roundTime * 1000).toLocaleString() : '—';

    // Detail line (app ID, created asset, note preview, group)
    const details: string[] = [];
    if (tx.createdAppId) details.push(`Created App ${tx.createdAppId}`);
    if (tx.createdAssetId) details.push(`Created ASA ${tx.createdAssetId}`);
    if (tx.appId && !tx.createdAppId) details.push(`App ${tx.appId}`);
    if (tx.fee > 1000) details.push(`Fee: ${microAlgosToAlgo(tx.fee, 4)}`);
    if (tx.group) details.push('Group tx');
    if (tx.note && tx.note.length > 0) {
      const preview = tx.note.length > 40 ? tx.note.slice(0, 40) + '...' : tx.note;
      details.push(preview);
    }

    // Explorer links
    const links: HTMLElement[] = [
      el('a', { text: 'tx', cls: 'parsec-tx-link', attrs: { href: explorerUrl(tx.id, network), target: '_blank', rel: 'noopener' } }),
    ];
    if (tx.createdAppId) {
      links.push(el('a', { text: 'app', cls: 'parsec-tx-link', attrs: { href: appExplorerUrl(tx.createdAppId, network), target: '_blank', rel: 'noopener' } }));
    }
    if (tx.createdAssetId) {
      links.push(el('a', { text: 'asset', cls: 'parsec-tx-link', attrs: { href: assetExplorerUrl(tx.createdAssetId, network), target: '_blank', rel: 'noopener' } }));
    }
    if (tx.appId && !tx.createdAppId) {
      links.push(el('a', { text: 'app', cls: 'parsec-tx-link', attrs: { href: appExplorerUrl(tx.appId, network), target: '_blank', rel: 'noopener' } }));
    }

    const rowChildren: HTMLElement[] = [
      el('div', {
        cls: 'parsec-tx-row__info',
        children: [
          el('span', { cls: `parsec-tx-row__type parsec-tx-row__type--${typeCls}`, text: label }),
          el('span', { cls: 'parsec-tx-row__address', text: counterpartyShort }),
          el('span', { cls: 'parsec-tx-row__date', text: date }),
          details.length > 0
            ? el('span', { cls: 'parsec-tx-row__detail', text: details.join(' · ') })
            : el('span'),
          el('div', { cls: 'parsec-tx-row__links', children: links }),
        ],
      }),
      el('div', { cls: 'parsec-tx-row__amount', text: amountText ? `${sign}${amountText} ${unit}` : label }),
    ];

    container.appendChild(el('div', { cls: `parsec-tx-row parsec-tx-row--${typeCls}`, children: rowChildren }));
  }
}
