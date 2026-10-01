// PARSEC Wallet — Identity View
// ERC-8004 agent identity + BANKON IDNFT management.
// Maps VaultIdentity <-> AgentRegistration across Algorand + EVM.

import { el, btn } from '../lib/dom';
import { store } from '../lib/store';
import { truncateAddress } from '../lib/algorand/account';
import { AgenticPlaceClient } from '../lib/x402/agenticplace-client';
import { checkBankonHolder } from '../lib/x402/discount';
import { PriceOracle } from '../lib/x402/oracle';
import {
  TIER_NAMES,
  TIER_THRESHOLDS,
  BANKON_ASA_ID,
  BANKON_SUPPLY,
  ERC8004_MAINNET,
  type AccessTier,
} from '../lib/x402';

const client = new AgenticPlaceClient();
const oracle = new PriceOracle();

export function identityView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];

  if (!account) {
    store.navigate('dashboard');
    return el('div');
  }

  const container = el('div', {
    cls: 'parsec-view parsec-identity',
    children: [
      // Header
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Identity' }),
        ],
      }),

      // Algorand identity section
      el('div', {
        cls: 'parsec-identity__section',
        children: [
          el('h3', { text: 'Algorand (BANKON)' }),
          el('div', {
            cls: 'parsec-identity__address',
            children: [
              el('span', { cls: 'parsec-identity__label', text: 'Address' }),
              el('code', { text: account.address }),
            ],
          }),
          el('div', { attrs: { id: 'identity-algo-status' }, text: 'Checking BANKON status...' }),
        ],
      }),

      // ERC-8004 section
      el('div', {
        cls: 'parsec-identity__section',
        children: [
          el('h3', { text: 'ERC-8004 (Cross-Chain)' }),
          el('div', {
            cls: 'parsec-identity__info',
            children: [
              infoRow('Identity Registry', truncateAddress(ERC8004_MAINNET.identityRegistry)),
              infoRow('Reputation Registry', truncateAddress(ERC8004_MAINNET.reputationRegistry)),
              infoRow('Deployed On', '15+ EVM chains (CREATE2)'),
            ],
          }),
          el('div', { attrs: { id: 'identity-erc8004-status' }, text: 'Checking IDNFT status...' }),
        ],
      }),

      // Access tier section
      el('div', {
        cls: 'parsec-identity__section',
        children: [
          el('h3', { text: 'Access Tiers' }),
          el('div', {
            cls: 'parsec-identity__tiers',
            children: ([0, 1, 2, 3, 4, 5] as AccessTier[]).map(tier =>
              el('div', {
                cls: 'parsec-identity__tier',
                children: [
                  el('span', { cls: 'parsec-identity__tier-name', text: TIER_NAMES[tier] }),
                  el('span', {
                    cls: 'parsec-identity__tier-req',
                    text: tier === 0 ? 'Open'
                      : tier === 1 ? 'IDNFT required'
                      : `${TIER_THRESHOLDS[tier].toString()} BONA FIDE`,
                  }),
                ],
              }),
            ),
          }),
        ],
      }),

      // BANKON token info
      el('div', {
        cls: 'parsec-identity__section',
        children: [
          el('h3', { text: 'BANKON Token' }),
          el('div', {
            cls: 'parsec-identity__info',
            children: [
              infoRow('ASA ID', String(BANKON_ASA_ID)),
              infoRow('Total Supply', BANKON_SUPPLY.toLocaleString()),
              infoRow('Decimals', '0 (whole units only)'),
              infoRow('Clawback', 'None (sovereign)'),
              infoRow('Holder Discount', '50% off x402 fees'),
            ],
          }),
          el('div', { attrs: { id: 'identity-bankon-price' }, text: 'Fetching BANKON price...' }),
        ],
      }),

      // Actions
      el('div', {
        cls: 'parsec-identity__actions',
        children: [
          btn('Browse Agents', {
            intent: 'primary', large: true,
            onClick: () => store.navigate('agents'),
          }),
        ],
      }),
    ],
  });

  // Load identity data
  loadIdentityData(account.address);

  return container;
}

async function loadIdentityData(address: string): Promise<void> {
  // Check BANKON holder status
  try {
    const status = await checkBankonHolder(address);
    const statusEl = document.getElementById('identity-algo-status');
    if (statusEl) {
      if (status.isHolder) {
        statusEl.innerHTML = '';
        statusEl.appendChild(el('div', {
          cls: 'parsec-identity__status parsec-identity__status--active',
          children: [
            el('strong', { text: 'BANKON Holder' }),
            el('span', { text: ` — ${status.balance.toLocaleString()} BANKON` }),
            el('span', { cls: 'parsec-identity__badge', text: '50% Discount Active' }),
          ],
        }));
      } else {
        statusEl.innerHTML = '';
        statusEl.appendChild(el('div', {
          cls: 'parsec-identity__status',
          text: 'Not a BANKON holder. Opt-in to ASA 203977300 to receive tokens.',
        }));
      }
    }
  } catch {
    /* offline — skip */
  }

  // Check ERC-8004 IDNFT (via BANKON service)
  try {
    const idnft = await client.checkIdentity(address);
    const erc8004El = document.getElementById('identity-erc8004-status');
    if (erc8004El) {
      if (idnft.hasIdnft) {
        erc8004El.innerHTML = '';
        erc8004El.appendChild(el('div', {
          cls: 'parsec-identity__status parsec-identity__status--active',
          children: [
            el('strong', { text: `Agent #${idnft.agentId}` }),
            el('span', { text: ` — ${idnft.tierName || 'Citizen'}` }),
          ],
        }));
      } else {
        erc8004El.textContent = 'No IDNFT registered for this address.';
      }
    }
  } catch {
    const erc8004El = document.getElementById('identity-erc8004-status');
    if (erc8004El) erc8004El.textContent = 'BANKON service offline.';
  }

  // Fetch BANKON price
  try {
    const price = await oracle.getBankonPrice();
    const priceEl = document.getElementById('identity-bankon-price');
    if (priceEl) {
      if (price.usd > 0) {
        priceEl.textContent = `BANKON: $${price.usd.toFixed(6)} USD / ${price.algo.toFixed(6)} ALGO`;
      } else {
        priceEl.textContent = 'BANKON: No liquidity pool found (not yet trading)';
      }
    }
  } catch {
    /* offline */
  }
}

function infoRow(label: string, value: string): HTMLElement {
  return el('div', {
    cls: 'parsec-identity__row',
    children: [
      el('span', { cls: 'parsec-identity__label', text: label }),
      el('span', { cls: 'parsec-identity__value', text: value }),
    ],
  });
}
