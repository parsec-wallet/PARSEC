// Solana key handling for the permaweb module — thin re-exports over the chain pack's secret formats
// (src/lib/solana/secret.ts) plus the vault-facing import helper. The participant holds the key:
// import stores the secret in the vault under its own address and maps it onto the account.

import { keystoreStore } from '../../keystore';
import { setAccountAddress } from '../../store';
import type { WalletAccount } from '../../../types/wallet';
import { parseSolanaSecret, encodeVaultSecret, keypairFromVaultSecret, previewSolanaSecret, toKeypairJson } from '../../solana/secret';

export { parseSolanaSecret, encodeVaultSecret, keypairFromVaultSecret, previewSolanaSecret, toKeypairJson };

/**
 * Import an existing Solana key (mnemonic / base58 keypair / JSON keypair) into the vault and map
 * it onto `account` under `chainId` (default 'solana'). Returns the updated account + address.
 */
export async function importSolanaKeyToVault(
  input: string,
  passphrase: string,
  account: WalletAccount,
  opts: { chainId?: string; label?: string } = {},
): Promise<{ account: WalletAccount; address: string }> {
  const parsed = parseSolanaSecret(input);
  const vaultSecret = encodeVaultSecret(parsed);
  const kp = await keypairFromVaultSecret(vaultSecret);
  kp.secretSeed.fill(0);
  await keystoreStore(kp.address, vaultSecret, passphrase, opts.label ?? 'Solana (imported)', 'solana');
  return { account: setAccountAddress(account, opts.chainId ?? 'solana', kp.address), address: kp.address };
}
