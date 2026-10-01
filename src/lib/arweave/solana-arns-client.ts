// solana-arns-client.ts — the AR.IO Solana-era ArNS client (post-migration; the AO-era client in
// ario.ts/ant.ts stays for legacy reads). All @ar.io/sdk + @solana/kit usage is behind dynamic
// imports so Vite code-splits it out of the base wallet bundle.
//
// Reads: unsigned ARIO.init({rpc}). Writes: the vault-bridged kit signer (kit-signer.ts) — the
// wallet never custodies raw keys in this module.

import { SOLANA_RPC } from '../solana/balance';
import { createVaultTransactionSigner } from '../solana/kit-signer';

export interface SolArnsRecord {
  name: string;
  type: 'lease' | 'permabuy';
  processId: string;
  startTimestamp?: number;
  endTimestamp?: number;
  undernameLimit: number;
  purchasePrice?: string;
}

async function sdk() {
  return import('@ar.io/sdk');
}

async function rpcHandle() {
  const { createSolanaRpc } = await import('@solana/kit');
  return createSolanaRpc(SOLANA_RPC);
}

async function readClient() {
  const m = await sdk();
  return m.ARIO.init({ rpc: await rpcHandle() });
}

async function writeClient(address: string, passphrase: string) {
  const m = await sdk();
  const { createSolanaRpcSubscriptions } = await import('@solana/kit');
  const signer = await createVaultTransactionSigner(address, passphrase);
  const rpcSubscriptions = createSolanaRpcSubscriptions(SOLANA_RPC.replace(/^http/, 'ws'));
  return { ario: m.ARIO.init({ rpc: await rpcHandle(), rpcSubscriptions, signer }), signer, m };
}

async function antFor(processId: string, signer?: unknown) {
  const m = await sdk();
  return m.ANT.init({ rpc: await rpcHandle(), processId, ...(signer ? { signer } : {}) } as never);
}

const sig = (res: unknown): string => {
  const r = res as { signature?: string; txSignature?: string; id?: string };
  return String(r?.signature ?? r?.txSignature ?? r?.id ?? res);
};

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function getRecord(name: string): Promise<SolArnsRecord | null> {
  const ario = await readClient();
  try {
    const r = (await ario.getArNSRecord({ name })) as Record<string, unknown>;
    return r ? ({ name, ...r, processId: String(r.processId) } as unknown as SolArnsRecord) : null;
  } catch {
    return null;
  }
}

export async function getAntState(processId: string): Promise<{
  owner: string | null;
  controllers: string[];
  records: Record<string, { transactionId: string; ttlSeconds: number }>;
}> {
  const ant = await antFor(processId);
  const [owner, controllers, records] = await Promise.all([
    ant.getOwner().then(String).catch(() => null),
    ant.getControllers().then((cs: unknown[]) => (cs ?? []).map(String)).catch(() => []),
    ant.getRecords().catch(() => ({})),
  ]);
  return { owner, controllers, records: records as never };
}

export async function getCost(opts: {
  intent: 'Buy-Name' | 'Extend-Lease' | 'Increase-Undername-Limit';
  name: string;
  purchaseType?: 'lease' | 'permabuy';
  years?: number;
  quantity?: number;
}): Promise<bigint> {
  const ario = await readClient();
  const cost = await ario.getTokenCost({
    intent: opts.intent,
    name: opts.name,
    ...(opts.purchaseType ? { type: opts.purchaseType } : {}),
    ...(opts.years ? { years: opts.years } : {}),
    ...(opts.quantity ? { quantity: opts.quantity } : {}),
  });
  return BigInt(String(cost));
}

export async function isReserved(name: string): Promise<boolean> {
  const ario = await readClient();
  try {
    const r = await (ario as { getArNSReservedName?: (o: { name: string }) => Promise<unknown> }).getArNSReservedName?.({ name });
    return !!r;
  } catch {
    return false;
  }
}

// ── Writes (vault-bridged) ────────────────────────────────────────────────────

export async function buyName(opts: {
  address: string; passphrase: string; name: string;
  purchaseType: 'lease' | 'permabuy'; years?: number;
}): Promise<{ id: string; processId?: string }> {
  const { ario } = await writeClient(opts.address, opts.passphrase);
  const res = await ario.buyRecord({
    name: opts.name,
    type: opts.purchaseType,
    ...(opts.purchaseType === 'lease' ? { years: opts.years ?? 1 } : {}),
  });
  const rec = await getRecord(opts.name);
  return { id: sig(res), processId: rec?.processId };
}

async function withAnt<T>(
  address: string, passphrase: string, name: string,
  fn: (ant: Awaited<ReturnType<typeof antFor>>) => Promise<T>,
): Promise<T> {
  const record = await getRecord(name);
  if (!record) throw new Error(`no ArNS record for ${name}`);
  const signer = await createVaultTransactionSigner(address, passphrase);
  const ant = await antFor(record.processId, signer);
  return fn(ant);
}

export const setBaseNameRecord = (o: { address: string; passphrase: string; name: string; transactionId: string; ttlSeconds?: number }) =>
  withAnt(o.address, o.passphrase, o.name, async (ant) => ({ id: sig(await ant.setBaseNameRecord({ transactionId: o.transactionId, ttlSeconds: o.ttlSeconds ?? 3600 })) }));

export const setUndernameRecord = (o: { address: string; passphrase: string; name: string; undername: string; transactionId: string; ttlSeconds?: number }) =>
  withAnt(o.address, o.passphrase, o.name, async (ant) => ({ id: sig(await ant.setUndernameRecord({ undername: o.undername, transactionId: o.transactionId, ttlSeconds: o.ttlSeconds ?? 3600 })) }));

export const removeUndernameRecord = (o: { address: string; passphrase: string; name: string; undername: string }) =>
  withAnt(o.address, o.passphrase, o.name, async (ant) => ({ id: sig(await ant.removeUndernameRecord({ undername: o.undername })) }));

export const transferAnt = (o: { address: string; passphrase: string; name: string; to: string }) =>
  withAnt(o.address, o.passphrase, o.name, async (ant) => ({ id: sig(await ant.transfer({ target: o.to })) }));

export const transferRecord = (o: { address: string; passphrase: string; name: string; undername: string; recipient: string }) =>
  withAnt(o.address, o.passphrase, o.name, async (ant) => ({ id: sig(await ant.transferRecord({ undername: o.undername, recipient: o.recipient })) }));

export const addController = (o: { address: string; passphrase: string; name: string; controller: string }) =>
  withAnt(o.address, o.passphrase, o.name, async (ant) => ({ id: sig(await ant.addController({ controller: o.controller })) }));

export const removeController = (o: { address: string; passphrase: string; name: string; controller: string }) =>
  withAnt(o.address, o.passphrase, o.name, async (ant) => ({ id: sig(await ant.removeController({ controller: o.controller })) }));

export async function extendLease(opts: { address: string; passphrase: string; name: string; years: number }): Promise<{ id: string }> {
  const { ario } = await writeClient(opts.address, opts.passphrase);
  return { id: sig(await ario.extendLease({ name: opts.name, years: opts.years })) };
}

export async function increaseUndernameLimit(opts: { address: string; passphrase: string; name: string; quantity: number }): Promise<{ id: string }> {
  const { ario } = await writeClient(opts.address, opts.passphrase);
  return { id: sig(await ario.increaseUndernameLimit({ name: opts.name, increaseCount: opts.quantity })) };
}

export async function requestPrimaryName(opts: { address: string; passphrase: string; name: string }): Promise<{ id: string }> {
  const { ario } = await writeClient(opts.address, opts.passphrase);
  return { id: sig(await ario.requestPrimaryName({ name: opts.name })) };
}
