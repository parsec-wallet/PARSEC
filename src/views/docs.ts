// Parsec Wallet — In-Wallet Documentation
// Quickstart, FAQ, security. All readable from within the wallet.

import { el, btn } from '../lib/dom';
import { store } from '../lib/store';

type DocSection = 'quickstart' | 'faq' | 'security' | 'assets' | 'spintrade' | 'about';

export function docsView(): HTMLElement {
  let activeSection: DocSection = 'quickstart';

  const content = el('div', { cls: 'parsec-docs__content' });
  const nav = el('div', { cls: 'parsec-docs__nav' });

  function renderNav() {
    nav.innerHTML = '';
    const sections: { id: DocSection; label: string }[] = [
      { id: 'quickstart', label: 'Quick Start' },
      { id: 'faq', label: 'FAQ' },
      { id: 'security', label: 'Security' },
      { id: 'assets', label: 'Assets' },
      { id: 'spintrade', label: 'SpinTrade' },
      { id: 'about', label: 'About' },
    ];
    for (const s of sections) {
      nav.appendChild(
        btn(s.label, {
          minimal: true,
          cls: `parsec-docs__tab ${activeSection === s.id ? 'parsec-docs__tab--active' : ''}`,
          onClick: () => { activeSection = s.id; renderNav(); renderContent(); },
        })
      );
    }
  }

  function renderContent() {
    content.innerHTML = '';
    content.appendChild(SECTIONS[activeSection]());
  }

  renderNav();
  renderContent();

  return el('div', {
    cls: 'parsec-view parsec-docs',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', {
            minimal: true, icon: 'arrow-left',
            onClick: () => {
              const state = store.get();
              store.navigate(state.accounts.length > 0 ? 'dashboard' : 'onboarding');
            },
          }),
          el('h2', { cls: 'parsec-view__title', text: 'Documentation' }),
        ],
      }),
      nav,
      content,
    ],
  });
}

// ── Doc Sections ─────────────────────────────────────────────────

const SECTIONS: Record<DocSection, () => HTMLElement> = {
  quickstart: () => el('div', {
    cls: 'parsec-docs__section',
    children: [
      el('h3', { text: 'Quick Start' }),
      el('h4', { text: '1. Create or Import a Wallet' }),
      el('p', { text: 'Choose "Create New Wallet" to generate a fresh 25-word recovery phrase, or "Import Existing Wallet" to restore from a recovery phrase or private key from Pera, MyAlgo, or any Algorand wallet.' }),
      el('h4', { text: '2. Save Your Recovery Phrase' }),
      el('p', { text: 'Write down your 25 words on paper. Store them offline. This is the ONLY way to recover your wallet. Parsec does not store your recovery phrase — you are solely responsible for it.' }),
      el('h4', { text: '3. Set a Passphrase' }),
      el('p', { text: 'Your passphrase encrypts your keys on this device. Choose something strong (8+ characters). If you forget it, you can always re-import using your recovery phrase.' }),
      el('h4', { text: '4. Fund Your Wallet' }),
      el('p', { text: 'Send ALGO to your public receive key. On testnet, use the faucet link on the dashboard. You need at least 0.1 ALGO to keep an account active on Algorand.' }),
      el('h4', { text: '5. Add Assets' }),
      el('p', { text: 'Tap "Add Asset" on the dashboard to opt in to Algorand Standard Assets (ASAs) like USDC. Each opt-in requires 0.101 ALGO (0.1 min balance increase + 0.001 fee).' }),
      el('h4', { text: '6. Send & Receive' }),
      el('p', { text: 'Use the Send button to transfer ALGO or any opted-in ASA. Every transaction shows a confirmation screen with fees before you sign. Share your public receive key to accept payments.' }),
    ],
  }),

  faq: () => el('div', {
    cls: 'parsec-docs__section',
    children: [
      el('h3', { text: 'Frequently Asked Questions' }),

      el('h4', { text: 'Does Parsec store my private key?' }),
      el('p', { text: 'No. Parsec never holds your private key or recovery phrase. Your secret is encrypted with your passphrase and stored locally on your device. On desktop, bankon_vault (Rust-side encryption) provides additional protection. Parsec cannot access your funds.' }),

      el('h4', { text: 'What happens if I forget my passphrase?' }),
      el('p', { text: 'Re-import your wallet using your 25-word recovery phrase. Set a new passphrase. Your funds are on the Algorand blockchain — as long as you have your recovery phrase, you can access them from any Algorand wallet.' }),

      el('h4', { text: 'What is the minimum balance?' }),
      el('p', { text: 'Every Algorand account must maintain at least 0.1 ALGO. Each ASA you opt into adds 0.1 ALGO to this minimum. The minimum balance is reserved by the network — you cannot spend it, but it is returned when you opt out of assets.' }),

      el('h4', { text: 'How do I add USDC or other tokens?' }),
      el('p', { text: 'Go to Dashboard → Add Asset. Search by name or asset ID. You need at least 0.101 ALGO available above your minimum balance to opt in. Only opt in to assets from verified issuers you trust.' }),

      el('h4', { text: 'What are freeze and clawback warnings?' }),
      el('p', { text: 'Some ASAs have a freeze address (the issuer can freeze your holdings) or a clawback address (the issuer can revoke your tokens). Parsec warns you before opting in to these assets. USDC and USDt have these addresses set by their official issuers (Circle, Tether) for regulatory compliance.' }),

      el('h4', { text: 'Can I use Parsec on the web?' }),
      el('p', { text: 'Yes. The web version uses Web Crypto API for key encryption in the browser. For maximum security, use the desktop version with bankon_vault and optional USB cold storage via Tomb encrypted volumes.' }),

      el('h4', { text: 'What networks does Parsec support?' }),
      el('p', { text: 'Algorand Mainnet, Testnet, and Betanet. Switch networks in Settings. When on Testnet, a faucet link appears on the dashboard for free test ALGO.' }),

      el('h4', { text: 'How does auto-lock work?' }),
      el('p', { text: 'Parsec locks your wallet after 5 minutes of inactivity (configurable in Settings). When locked, your passphrase is cleared from memory. You need to re-enter it to access your wallet.' }),
    ],
  }),

  security: () => el('div', {
    cls: 'parsec-docs__section',
    children: [
      el('h3', { text: 'Security Model' }),

      el('h4', { text: 'Key Sovereignty' }),
      el('p', { text: 'Parsec follows cypherpunk principles: your keys, your coins. Private keys and recovery phrases are never transmitted, never stored on servers, and never accessible to Parsec. You are the sole custodian.' }),

      el('h4', { text: 'Encryption (Desktop)' }),
      el('p', { text: 'bankon_vault uses Argon2id key derivation (memory-hard, GPU-resistant) with AES-256-GCM authenticated encryption. Keys are stored as individually encrypted files in the Tauri app data directory. The session key is held in Rust memory and zeroized on lock or exit.' }),

      el('h4', { text: 'Encryption (Web)' }),
      el('p', { text: 'The web version uses Web Crypto API with PBKDF2 (600,000 iterations, SHA-256) and AES-256-GCM. Encrypted data is stored in localStorage. While functional, the desktop version provides stronger security guarantees.' }),

      el('h4', { text: 'Cold Storage (Linux)' }),
      el('p', { text: 'On Linux, Parsec supports Tomb encrypted volumes. Your wallet data lives inside a LUKS-encrypted .tomb file. The key file can be stored on a USB drive — plug it in to access your wallet, remove it for cold storage. Without both the USB key and your passphrase, the data is inaccessible.' }),

      el('h4', { text: 'Session Management' }),
      el('p', { text: 'Your passphrase is held in memory only during an active session — never written to disk or localStorage. Auto-lock clears it after inactivity. The wallet requires your passphrase to sign any transaction.' }),

      el('h4', { text: 'What Parsec Does NOT Do' }),
      el('p', { text: 'Parsec does not run analytics, tracking, or telemetry. Does not phone home. Does not have a backend server. Does not store your keys. Does not have a master key or recovery backdoor. If you lose your recovery phrase, your funds are permanently inaccessible.' }),
    ],
  }),

  assets: () => el('div', {
    cls: 'parsec-docs__section',
    children: [
      el('h3', { text: 'Algorand Standard Assets (ASAs)' }),

      el('h4', { text: 'What are ASAs?' }),
      el('p', { text: 'ASAs are tokens on the Algorand blockchain. They can represent anything — stablecoins (USDC, USDt), utility tokens, NFTs, or real-world assets. ASAs benefit from Algorand\'s speed (3.3s finality) and low fees (0.001 ALGO per transaction).' }),

      el('h4', { text: 'Opt-In Required' }),
      el('p', { text: 'Before you can receive an ASA, you must opt in. This is a 0-amount transaction to yourself that tells the network you accept this asset. It costs 0.001 ALGO in fees and increases your minimum balance by 0.1 ALGO.' }),

      el('h4', { text: 'Opt-Out to Recover Balance' }),
      el('p', { text: 'If you no longer want an ASA, you can remove it from your dashboard (only when balance is 0). This returns the 0.1 ALGO minimum balance to your available balance.' }),

      el('h4', { text: 'Verified Assets in Parsec' }),
      el('p', { text: 'Parsec includes a short list of verified assets from official issuers: USDC (Circle) and USDt (Tether). You can add any ASA by searching its name or ID — but always verify the issuer before opting in to unknown assets.' }),

      el('h4', { text: 'Decimals' }),
      el('p', { text: 'All amounts are displayed with up to 6 decimal places by default. ALGO uses 6 decimals (1 ALGO = 1,000,000 microAlgos). USDC and USDt also use 6 decimals. Other assets may vary — Parsec reads the correct decimals from the blockchain.' }),
    ],
  }),

  spintrade: () => el('div', {
    cls: 'parsec-docs__section',
    children: [
      el('h3', { text: 'SpinTrade DEX Aggregator' }),
      el('p', { text: 'SpinTrade queries multiple Algorand AMMs in parallel, finds the best price, and lets you choose your swap path. All on-chain modules read data directly from Algod and Indexer — zero third-party API dependencies.' }),

      el('h4', { text: 'DEX Sources' }),
      el('p', { text: 'Tinyman v2 (on-chain) — primary sovereign source. Pact (on-chain) — second AMM with different liquidity. Both enabled by default. Tinyman API module available but disabled (centralized data source).' }),

      el('h4', { text: 'Multi-Hop Routing' }),
      el('p', { text: 'When no direct pool exists between two ASAs, SpinTrade routes through ALGO: ASA_A → ALGO → ASA_B. Both hops are fetched from all DEX sources. The aggregator compares direct vs multi-hop and returns whichever gives better output. Cross-DEX routing is supported (e.g. hop 1 via Pact, hop 2 via Tinyman).' }),

      el('h4', { text: 'Slippage Tolerance' }),
      el('p', { text: 'Presets: 0.1%, 0.25%, 0.5% (default), 1%, 2%. Custom values up to 50%. Applied as basis points — 50 bps = 0.5%. The swap reverts on-chain if price moves beyond your tolerance.' }),

      el('h4', { text: 'Fees' }),
      el('p', { text: 'DEX fee: 0.3% per hop (standard AMM fee). Multi-hop swaps incur 0.6% total (two hops). Algorand transaction fees: 0.001 ALGO per transaction in the swap group. SpinTrade charges no additional fee.' }),

      el('h4', { text: 'Swap History' }),
      el('p', { text: 'All successful swaps are saved locally (localStorage). Last 10 displayed at the bottom of the swap view. Records include: pair, DEX source, hop count, tx ID, and timestamp. No data is transmitted — history is device-local only. Max 100 records, oldest trimmed automatically.' }),

      el('h4', { text: 'Pool Discovery' }),
      el('p', { text: 'Available output assets are shown as pool cards with live price and liquidity data. Pools are discovered by searching recent AMM transactions on the blockchain, then reading pool account balances for reserves. Known high-liquidity pairs (ALGO, USDC, USDt, goBTC, goETH) are always included as fallback.' }),

      el('h4', { text: 'Quote Card' }),
      el('p', { text: 'Each quote shows: route (direct or multi-hop), expected output, exchange rate, minimum received after slippage, price impact, fee breakdown, and slippage tolerance. Review all fields before confirming. The swap button shows hop count for multi-hop routes.' }),
    ],
  }),

  about: () => el('div', {
    cls: 'parsec-docs__section',
    children: [
      el('h3', { text: 'About Parsec' }),
      el('p', { text: 'Parsec is the evolution of the cryptocurrency wallet. Built on cypherpunk principles: sovereign, modular, Algorand-first.' }),

      el('h4', { text: 'Architecture' }),
      el('p', { text: 'Tauri desktop shell with Rust backend. Vanilla TypeScript frontend — no React, no frameworks. Blueprint.js CSS for styling. Zero runtime dependencies beyond algosdk. Designed to run as a desktop app or served from a dApp as a web wallet.' }),

      el('h4', { text: 'bankon_vault' }),
      el('p', { text: 'A modular encrypted key vault built in Rust. Portable across wallets — any Tauri application can use bankon_vault for secure key storage. Argon2id + AES-256-GCM encryption with optional Tomb cold storage on Linux.' }),

      el('h4', { text: 'Open Source' }),
      el('p', { text: 'Parsec is built by cypherpunk2048. The wallet is designed to be auditable, extensible, and sovereign. No blind trust — read the code.' }),

      el('h4', { text: 'Paper Export' }),
      el('p', { text: 'Parsec Paper Export is a free offline Bitcoin wallet generator forked from bitaddress.org. Single self-contained HTML file — 937KB, zero remote dependencies. Generate, print, and verify Bitcoin wallets offline. All wallet types: single, paper, bulk, brain, vanity, split. Cypherpunk2048 Standard.' }),

      el('h4', { text: 'Roadmap' }),
      el('p', { text: 'Algorand first. Bitcoin via Paper Export and future Core integration. Multi-chain sovereign holdings: BTC, LTC, XMR, ETH, SOL. SpinTrade DEX aggregator (shipped — Tinyman + Pact, multi-hop routing, swap history). WalletConnect (ARC-25). ASA/NFT minter extensions. Wallet Pouch architecture for multi-chain identity.' }),

      el('h4', { text: 'Contact' }),
      el('p', { text: 'github@deltav.exchange' }),
    ],
  }),
};
