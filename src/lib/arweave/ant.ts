// Arweave Name Token (ANT) helpers — spawn the per-name AO process and
// edit its records. Used by Parsec to:
//   * Spawn the ANT immediately before Buy-Name on the AR.IO Registry.
//   * Bind the Parsec permaweb deployment tx-id to the @ (root) record.
//
// We resolve the latest ANT module id at runtime via the ANT Registry —
// hardcoding the module id ages out fast (the SDK deprecated AOS_MODULE_ID
// for exactly this reason).

import type { ArweaveSigner } from './signer';
import {
  aoDryRun,
  aoMessage,
  aoResult,
  aoSpawn,
  buildAoMessageInput,
  buildAoSpawnInput,
} from './ao';
import { signDataItemFromVault, type DataItemInput } from './ans104';
import {
  ANT_REGISTRY_MAINNET,
  AO_AUTHORITY,
  DEFAULT_SCHEDULER,
} from './ario';

/** Look up the latest ANT module id from the ANT Registry. */
export async function getLatestAntModuleId(): Promise<string> {
  const res = await aoDryRun({
    process: ANT_REGISTRY_MAINNET,
    tags: [{ name: 'Action', value: 'Latest-ANT-Version' }],
  });
  const data = (res as unknown as { Data?: unknown }).Data;
  if (typeof data === 'string') {
    // Some CUs return a JSON-wrapped object {"moduleId": "..."}, others a bare id.
    const trimmed = data.trim().replace(/^"|"$/g, '');
    if (/^[A-Za-z0-9_-]{43}$/.test(trimmed)) return trimmed;
    try {
      const parsed = JSON.parse(data);
      const id = parsed?.moduleId ?? parsed?.id ?? parsed?.ModuleId;
      if (typeof id === 'string' && /^[A-Za-z0-9_-]{43}$/.test(id)) return id;
    } catch { /* fallthrough */ }
  }
  throw new Error('ANT Registry did not return a valid module id');
}

export interface SpawnAntOpts {
  address: string;
  passphrase: string;
  /** The name the ANT will control (used as a tag on the spawn). */
  name: string;
  /** Override the module id. Defaults to the live ANT Registry lookup. */
  moduleId?: string;
  /** Override the scheduler. Defaults to DEFAULT_SCHEDULER. */
  scheduler?: string;
  /** Max seconds to wait for the spawn to land before giving up. */
  timeoutSec?: number;
}

export interface SpawnAntResult {
  processId: string;
  moduleId: string;
}

/**
 * Spawn an ANT process owned by the given Arweave address. Returns the new
 * process id (== the spawn DataItem id). Polls the CU for spawn confirmation
 * with the supplied timeout so the caller knows it's safe to message the
 * process immediately afterwards (e.g. Buy-Name).
 */
export async function spawnAnt(opts: SpawnAntOpts): Promise<SpawnAntResult> {
  const moduleId = opts.moduleId ?? (await getLatestAntModuleId());
  const scheduler = opts.scheduler ?? DEFAULT_SCHEDULER;

  const spawnInput = buildAoSpawnInput({
    module: moduleId,
    scheduler,
    tags: [
      { name: 'Authority', value: AO_AUTHORITY },
      { name: 'Name', value: opts.name },
    ],
  });
  const signed = await signDataItemFromVault(opts.address, opts.passphrase, spawnInput);
  await aoSpawn(signed);

  // Poll until the CU acknowledges the new process. AO processes appear
  // within a few seconds; we cap at the supplied timeout to fail fast.
  const deadline = Date.now() + 1000 * (opts.timeoutSec ?? 90);
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await aoResult({ message: signed.id, process: signed.id });
      return { processId: signed.id, moduleId };
    } catch (e) {
      lastErr = e;
      await sleep(2000);
    }
  }
  throw new Error(
    `ANT spawn ${signed.id} not confirmed within ${opts.timeoutSec ?? 90}s — try again later. (${lastErr instanceof Error ? lastErr.message : ''})`,
  );
}

export interface SetAntRootRecordOpts {
  signer: ArweaveSigner;
  antProcessId: string;
  transactionId: string;
  ttlSeconds?: number;
}

/**
 * Set the `@` (root) record on an ANT. After this lands, the gateway
 * resolves `https://<name>.arweave.net` to the supplied transactionId.
 */
export async function setAntRootRecord(opts: SetAntRootRecordOpts): Promise<{ id: string }> {
  const input: Omit<DataItemInput, 'owner'> = buildAoMessageInput({
    process: opts.antProcessId,
    tags: [
      { name: 'Action', value: 'Set-Record' },
      { name: 'Sub-Domain', value: '@' },
      { name: 'Transaction-Id', value: opts.transactionId },
      { name: 'TTL-Seconds', value: String(opts.ttlSeconds ?? 3600) },
    ],
  });
  const signed = await opts.signer.signDataItem(input);
  return await aoMessage(signed);
}

// ── ANT read helpers ─────────────────────────────────────────

export interface AntInfo {
  owner: string;
  controllers: string[];
  name: string;
  ticker: string;
  records: Record<string, { transactionId: string; ttlSeconds: number }>;
  logo?: string;
}

/** Dry-run an ANT's Info handler. */
export async function getAntInfo(antProcessId: string): Promise<AntInfo> {
  const res = await aoDryRun({
    process: antProcessId,
    tags: [{ name: 'Action', value: 'Info' }],
  });
  const data = (res as unknown as { Data?: unknown }).Data;
  if (typeof data !== 'string') {
    throw new Error(`ANT ${antProcessId} returned no Info data`);
  }
  const parsed = JSON.parse(data);
  return {
    owner: parsed.Owner ?? parsed.owner ?? '',
    controllers: parsed.Controllers ?? parsed.controllers ?? [],
    name: parsed.Name ?? parsed.name ?? '',
    ticker: parsed.Ticker ?? parsed.ticker ?? '',
    records: parsed.Records ?? parsed.records ?? {},
    logo: parsed.Logo ?? parsed.logo,
  };
}

/** Convenience: just the records map. */
export async function getAntRecords(antProcessId: string): Promise<AntInfo['records']> {
  const info = await getAntInfo(antProcessId);
  return info.records;
}

// ── ANT write helpers ───────────────────────────────────────

export interface SetAntUndernameOpts {
  signer: ArweaveSigner;
  antProcessId: string;
  subdomain: string;   // non-@; '@' should go through setAntRootRecord
  transactionId: string;
  ttlSeconds?: number;
}

/** Set or update an undername record on an ANT. */
export async function setAntUndername(opts: SetAntUndernameOpts): Promise<{ id: string }> {
  if (opts.subdomain === '@') {
    throw new Error('Use setAntRootRecord for the root @ record');
  }
  const input: Omit<DataItemInput, 'owner'> = buildAoMessageInput({
    process: opts.antProcessId,
    tags: [
      { name: 'Action', value: 'Set-Record' },
      { name: 'Sub-Domain', value: opts.subdomain },
      { name: 'Transaction-Id', value: opts.transactionId },
      { name: 'TTL-Seconds', value: String(opts.ttlSeconds ?? 3600) },
    ],
  });
  const signed = await opts.signer.signDataItem(input);
  return await aoMessage(signed);
}

export interface RemoveAntRecordOpts {
  signer: ArweaveSigner;
  antProcessId: string;
  subdomain: string;
}

export async function removeAntRecord(opts: RemoveAntRecordOpts): Promise<{ id: string }> {
  const input: Omit<DataItemInput, 'owner'> = buildAoMessageInput({
    process: opts.antProcessId,
    tags: [
      { name: 'Action', value: 'Remove-Record' },
      { name: 'Sub-Domain', value: opts.subdomain },
    ],
  });
  const signed = await opts.signer.signDataItem(input);
  return await aoMessage(signed);
}

export interface TransferAntOwnershipOpts {
  signer: ArweaveSigner;
  antProcessId: string;
  to: string;
}

/**
 * Transfer ANT ownership. Different from a BNR Transfer: the ArNS Registry's
 * record still points at the same ANT processId; only the ANT's `owner`
 * field rotates. Effective ownership of the name moves with the ANT.
 */
export async function transferAntOwnership(opts: TransferAntOwnershipOpts): Promise<{ id: string }> {
  const input: Omit<DataItemInput, 'owner'> = buildAoMessageInput({
    process: opts.antProcessId,
    tags: [
      { name: 'Action', value: 'Transfer' },
      { name: 'Recipient', value: opts.to },
    ],
  });
  const signed = await opts.signer.signDataItem(input);
  return await aoMessage(signed);
}

export interface SetAntControllerOpts {
  signer: ArweaveSigner;
  antProcessId: string;
  controller: string;
  action: 'add' | 'remove';
}

/** Add or remove a controller on the ANT. */
export async function setAntController(opts: SetAntControllerOpts): Promise<{ id: string }> {
  const input: Omit<DataItemInput, 'owner'> = buildAoMessageInput({
    process: opts.antProcessId,
    tags: [
      { name: 'Action', value: opts.action === 'add' ? 'Add-Controller' : 'Remove-Controller' },
      { name: 'Controller', value: opts.controller },
    ],
  });
  const signed = await opts.signer.signDataItem(input);
  return await aoMessage(signed);
}

/**
 * Acknowledge a Primary-Name-Request from the ANT side. ArNS uses a
 * two-step primary-name flow: the owner sends Primary-Name-Request to the
 * AR.IO Registry, and the ANT (which controls the name) must acknowledge.
 * The ANT side is what this helper sends.
 */
export async function primaryNameAcknowledge(opts: { signer: ArweaveSigner; antProcessId: string; name: string }): Promise<{ id: string }> {
  const input: Omit<DataItemInput, 'owner'> = buildAoMessageInput({
    process: opts.antProcessId,
    tags: [
      { name: 'Action', value: 'Approve-Primary-Name' },
      { name: 'Name', value: opts.name },
    ],
  });
  const signed = await opts.signer.signDataItem(input);
  return await aoMessage(signed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
