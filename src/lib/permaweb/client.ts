// ar.io SDK clients for the permaweb module. Same shape as src/lib/arweave/solana-arns-client.ts
// (dynamic imports so the SDK + kit stay out of the base bundle), plus the module's own RPC / cluster
// settings. Only `ARIO.init` exists in @ar.io/sdk 4.x — `ARIO.mainnet()` in docs.ar.io does not.

import { createVaultTransactionSigner } from '../solana/kit-signer';
import { getPermawebSettings, resolveWsUrl } from './settings';

export async function sdk() {
  return import('@ar.io/sdk');
}

async function kit() {
  return import('@solana/kit');
}

export async function solanaRpcHandle() {
  const { createSolanaRpc } = await kit();
  return createSolanaRpc(getPermawebSettings().rpcUrl);
}

/** Program-id overrides for the configured cluster (mainnet needs none). */
async function programOverrides() {
  const s = getPermawebSettings();
  if (s.cluster !== 'devnet') return {};
  const m = await sdk();
  const ids = m.DEVNET_PROGRAM_IDS as Record<string, string>;
  return { coreProgramId: ids.core, garProgramId: ids.gar, arnsProgramId: ids.arns, antProgramId: ids.ant };
}

/** Read-only ARIO client. */
export async function readArio() {
  const m = await sdk();
  return m.ARIO.init({ rpc: await solanaRpcHandle(), ...(await programOverrides()) } as never);
}

/** Vault-signing ARIO client — the operator key never leaves kit-signer.ts. */
export async function writeArio(address: string, passphrase: string) {
  const m = await sdk();
  const { createSolanaRpcSubscriptions } = await kit();
  const signer = await createVaultTransactionSigner(address, passphrase);
  const rpcSubscriptions = createSolanaRpcSubscriptions(resolveWsUrl());
  const ario = m.ARIO.init({ rpc: await solanaRpcHandle(), rpcSubscriptions, signer, ...(await programOverrides()) } as never);
  return { ario, signer, m };
}

/** Normalise an SDK write result to a transaction signature string. */
export function sig(res: unknown): string {
  const r = res as { signature?: string; txSignature?: string; id?: string };
  return String(r?.signature ?? r?.txSignature ?? r?.id ?? res);
}
