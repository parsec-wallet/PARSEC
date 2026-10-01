// Vault-custodied EVM key (Base). The participant imports a hex private key; it is stored in the
// vault under its own address (chain 'ethereum') and only ever handed to the Rust EIP-1559 signer
// (src-tauri/src/chain_evm) inside the Tauri process. No viem/ethers in the frontend.

import { ethereumModule } from '../../pouch/chains';
import { keystoreStore } from '../../keystore';
import { getAccountAddress, setAccountAddress } from '../../store';
import { invoke, isTauri } from '../../platform';
import type { WalletAccount } from '../../../types/wallet';

export const EVM_CHAIN_ID = 'ethereum';

export function normalizeEvmPrivateKey(input: string): string {
  const s = input.trim().replace(/^0X/, '0x');
  const hex = s.startsWith('0x') ? s : `0x${s}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Expected a 32-byte hex private key');
  return hex.toLowerCase();
}

/** Address for a key, without storing it. */
export async function previewEvmKey(input: string): Promise<string> {
  const hex = normalizeEvmPrivateKey(input);
  return (await ethereumModule.importWallet(hex, 'private-key')).address;
}

export async function importEvmKeyToVault(input: string, passphrase: string, account: WalletAccount): Promise<{ account: WalletAccount; address: string }> {
  const hex = normalizeEvmPrivateKey(input);
  const address = (await ethereumModule.importWallet(hex, 'private-key')).address;
  await keystoreStore(address, hex, passphrase, 'EVM (Base)', EVM_CHAIN_ID);
  return { account: setAccountAddress(account, EVM_CHAIN_ID, address), address };
}

export const readEvmAddress = (account: WalletAccount): string | undefined => getAccountAddress(account, EVM_CHAIN_ID);

/** The vault-signing path exists only inside the Tauri shell (Rust holds k256). */
export const vaultEvmAvailable = (): boolean => isTauri;

export interface EvmTxRequest {
  chain_id: number; nonce: number; max_priority_fee_per_gas: string; max_fee_per_gas: string;
  gas_limit: number; to: string; value: string; data: string;
}

export async function signEvmTxInVault(address: string, tx: EvmTxRequest): Promise<{ raw_hex: string; tx_hash: string }> {
  return invoke<{ raw_hex: string; tx_hash: string }>('chain_evm_sign_tx', { address, tx });
}
