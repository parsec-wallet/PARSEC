// xchain — EVM-controlled Algorand account as a parsec WalletModule.
// signingAuthority is 'metamask'; no Algorand seed material exists for
// these accounts. The vault stores only the EVM-address mapping so the
// account shows up in vaultListAccounts() with a distinct chain tag.

import type {
  WalletModule,
  CreatedWallet,
  ImportedWallet,
  PublicSurface,
} from '../pouch/types';
import { detectInjectedProvider } from '../builder/isolation';
import { deriveAlgorandFromEvm } from './account';

const NET = 'mainnet'; // Address derivation is network-independent for the LogicSig template.

export const xchainModule: WalletModule = {
  chainId: 'algorand-xchain',
  name: 'Algorand (EVM-controlled)',
  enabled: true,

  async createWallet(): Promise<CreatedWallet> {
    // Detect injected EIP-1193 provider, request accounts, derive the LogicSig
    // address for the first one. There is no recovery material — MetaMask
    // remains the custodian.
    const provider = detectInjectedProvider();
    if (!provider) throw new Error('No injected EVM wallet detected (install MetaMask, Rabby, etc.)');
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts.length) throw new Error('No EVM accounts available');
    const evmAddress = accounts[0];
    const algoAddress = await deriveAlgorandFromEvm(evmAddress, NET);

    return {
      walletId: `xchain_${algoAddress.slice(0, 8)}`,
      chainId: 'algorand-xchain',
      address: algoAddress,
      // External-signer convention: empty recovery material. The "secret" is
      // the EVM key, which lives in the user's existing EVM wallet.
      recoveryMaterial: '',
    };
  },

  async importWallet(secret: string, format): Promise<ImportedWallet> {
    if (format === 'watch-only') {
      // `secret` is an EVM address (0x...). Derive the Algorand address it controls.
      if (!/^0x[a-fA-F0-9]{40}$/.test(secret)) {
        throw new Error('Expected an EVM address (0x...) to derive the controlled Algorand account');
      }
      const algoAddress = await deriveAlgorandFromEvm(secret, NET);
      return {
        walletId: `xchain_${algoAddress.slice(0, 8)}`,
        chainId: 'algorand-xchain',
        address: algoAddress,
        watchOnly: false, // Spendable via MetaMask, even though parsec holds no key.
      };
    }
    throw new Error(`xchain accounts can only be imported by EVM address (got format='${format}')`);
  },

  async deriveReceiveAddress(_walletId: string): Promise<string> {
    throw new Error('xchain LogicSig addresses are static — one EVM key controls one Algorand address.');
  },

  async signMessage(_walletId: string, _message: Uint8Array): Promise<Uint8Array> {
    // LogicSig only verifies transaction-group payloads on-chain. Arbitrary
    // message signing has no analog — use signTxnWithMetamask for actual txns.
    throw new Error('xchain signs transaction groups, not arbitrary messages. Use signTxnWithMetamask().');
  },

  async exportPublicSurface(walletId: string): Promise<PublicSurface> {
    return { chainId: 'algorand-xchain', surfaceType: 'address', value: walletId };
  },
};
