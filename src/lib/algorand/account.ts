// PARSEC Wallet — Account Management
import algosdk from 'algosdk';
import type { AccountInfo, AssetHolding, NetworkId } from '../../types/wallet';
import { getAlgodClient } from './client';

/**
 * Generate a new Algorand account.
 * Returns the 25-word mnemonic and address.
 */
export function generateAccount(): { mnemonic: string; address: string } {
  const account = algosdk.generateAccount();
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
  return { mnemonic, address: account.addr.toString() };
}

/**
 * Recover an account from a 25-word mnemonic.
 */
export function recoverAccount(mnemonic: string): { address: string; valid: boolean } {
  try {
    const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
    return { address: account.addr.toString(), valid: true };
  } catch {
    return { address: '', valid: false };
  }
}

/**
 * Validate a mnemonic phrase.
 */
export function validateMnemonic(mnemonic: string): boolean {
  try {
    algosdk.mnemonicToSecretKey(mnemonic.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch account information from the network.
 */
export async function fetchAccountInfo(
  address: string,
  network: NetworkId
): Promise<AccountInfo> {
  const client = getAlgodClient(network);
  const info = await client.accountInformation(address).do();

  const assets: AssetHolding[] = (info.assets || []).map((a) => ({
    assetId: Number(a.assetId),
    amount: Number(a.amount),
    isFrozen: a.isFrozen,
  }));

  return {
    address,
    amount: Number(info.amount),
    minBalance: Number(info.minBalance || 100000),
    assets,
    pendingRewards: Number(info.pendingRewards || 0),
    round: Number(info.round || 0),
  };
}

/**
 * Format microAlgos to ALGO.
 */
export function microAlgosToAlgo(microAlgos: number, decimals = 6): string {
  return (microAlgos / 1_000_000).toFixed(decimals);
}

/**
 * Format an address for display (first6...last4).
 */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
