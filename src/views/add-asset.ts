// Parsec Wallet — Add Asset (ASA Opt-In) View

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { getKnownAssets, searchAssets, optInToAsset } from '../lib/algorand/assets';
import { microAlgosToAlgo } from '../lib/algorand/account';
import { keystoreRetrieve } from '../lib/keystore';

export function addAssetView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return el('div'); }

  const network = state.settings.network;
  const known = getKnownAssets(network);
  const info = state.accountInfo;
  const optedIn = new Set((info?.assets || []).map(a => a.assetId));
  let searchQuery = '';
  const resultsContainer = el('div', { cls: 'parsec-add-asset__results' });

  // Available balance (never negative)
  const available = info ? Math.max(0, info.amount - info.minBalance) : 0;
  const balanceText = info
    ? `Available: ${microAlgosToAlgo(available)} ALGO`
    : 'Loading balance...';

  return el('div', {
    cls: 'parsec-view parsec-add-asset',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Add Asset' }),
        ],
      }),
      el('p', { cls: 'parsec-view__desc', text: 'You need at least 0.101 ALGO available to add an asset.' }),
      el('p', { cls: 'parsec-send__balance', text: balanceText }),

      el('div', {
        cls: 'parsec-add-asset__search-row',
        children: [
          input({ placeholder: 'Search by asset name or ID', cls: 'bp5-input bp5-large bp5-fill parsec-add-asset__search', onInput: (v) => { searchQuery = v; }, onEnter: doSearch }),
          btn('Search', { intent: 'primary', onClick: doSearch }),
        ],
      }),
      resultsContainer,

      el('h3', { cls: 'parsec-section-title', text: 'Verified Assets' }),
      el('div', {
        cls: 'parsec-add-asset__known',
        children: [
          // ALGO is always first — native, no opt-in needed
          el('div', {
            cls: 'parsec-asset-row parsec-asset-row--add',
            children: [
              el('div', {
                cls: 'parsec-asset-row__info',
                children: [
                  el('span', { cls: 'parsec-asset-row__name', text: 'Algorand' }),
                  el('span', { cls: 'parsec-asset-row__meta', text: 'ALGO · Native · 6 decimals' }),
                ],
              }),
              el('span', { cls: 'parsec-badge', text: 'Native' }),
            ],
          }),
          // Known ASAs
          ...known.map(a => assetRow(a.assetId, a.name, a.unitName, a.decimals, false, false, optedIn.has(a.assetId), account.address, network, available)),
        ],
      }),
    ],
  });

  async function doSearch() {
    if (!searchQuery.trim()) return;
    resultsContainer.innerHTML = '';
    resultsContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'Searching...' }));
    const results = await searchAssets(searchQuery.trim(), network);
    resultsContainer.innerHTML = '';
    if (results.length === 0) { resultsContainer.appendChild(el('div', { cls: 'parsec-empty', text: 'No assets found.' })); return; }
    for (const r of results) {
      resultsContainer.appendChild(assetRow(r.assetId, r.name, r.unitName, r.decimals, r.hasFreezeAddr, r.hasClawbackAddr, optedIn.has(r.assetId), account.address, network, available));
    }
  }
}

function assetRow(
  assetId: number, name: string, unitName: string, decimals: number,
  hasFreezeAddr: boolean, hasClawbackAddr: boolean,
  alreadyOptedIn: boolean, userAddress: string, network: string,
  availableBalance: number,
): HTMLElement {
  const warnings: HTMLElement[] = [];
  if (hasFreezeAddr) warnings.push(el('span', { cls: 'parsec-badge parsec-badge--warn', text: 'Freezable' }));
  if (hasClawbackAddr) warnings.push(el('span', { cls: 'parsec-badge parsec-badge--warn', text: 'Clawback' }));

  return el('div', {
    cls: 'parsec-asset-row parsec-asset-row--add',
    children: [
      el('div', {
        cls: 'parsec-asset-row__info',
        children: [
          el('span', { cls: 'parsec-asset-row__name', text: name }),
          el('span', { cls: 'parsec-asset-row__meta', text: `${unitName} · ID: ${assetId} · ${decimals} decimals` }),
          warnings.length > 0 ? el('div', { cls: 'parsec-asset-row__badges', children: warnings }) : el('span'),
        ],
      }),
      alreadyOptedIn
        ? el('span', { cls: 'parsec-badge', text: 'Added' })
        : btn('Opt In', {
            intent: 'success',
            onClick: async () => {
              const passphrase = store.getPassphrase();
              if (!passphrase) { toast('Session expired.', 'danger'); store.navigate('unlock'); return; }
              let mnemonic: string | null = await keystoreRetrieve(userAddress, passphrase);
              if (!mnemonic) { toast('Could not retrieve key.', 'danger'); return; }

              if (hasFreezeAddr || hasClawbackAddr) {
                const warns = [];
                if (hasFreezeAddr) warns.push('freeze your holdings');
                if (hasClawbackAddr) warns.push('revoke (clawback) your tokens');
                if (!confirm(`Warning: The issuer of this asset can ${warns.join(' and ')}. Continue?`)) {
                  mnemonic = '\0'.repeat(mnemonic.length); mnemonic = null;
                  return;
                }
              }

              if (availableBalance < 101_000) {
                const displayBal = (Math.max(0, availableBalance) / 1_000_000).toFixed(4);
                toast(`Insufficient balance. Need 0.101 ALGO, you have ${displayBal} ALGO available.`, 'danger');
                mnemonic = '\0'.repeat(mnemonic.length); mnemonic = null;
                return;
              }

              store.set({ isLoading: true });
              try {
                await optInToAsset(mnemonic, assetId, network as 'mainnet' | 'testnet' | 'betanet');
                store.set({ isLoading: false, accountInfo: null });
                toast(`Opted in to ${unitName || name}`, 'success');
                store.navigate('dashboard');
              } catch (err) {
                store.set({ isLoading: false });
                toast(err instanceof Error ? err.message : 'Opt-in failed', 'danger');
              } finally {
                if (mnemonic) mnemonic = '\0'.repeat(mnemonic.length);
                mnemonic = null;
              }
            },
          }),
    ],
  });
}
