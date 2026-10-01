// BANKON Names Registry client — mirror of src/lib/arweave/ario.ts but
// pointed at the PARSEC-owned BNR. Callers can swap the two namespaces
// at the type level without changing the surrounding code.

import type { DataItemInput, DataItemTag } from '../arweave/ans104';
import { aoDryRun, buildAoMessageInput, type AoMessageOutput } from '../arweave/ao';
import { getBnrProcessId, isBnrConfigured } from './process-id';
import { paymentProofToTags, paymentMethodUnit, type PaymentMethod, type PaymentProof } from './payment';

// ── Types ────────────────────────────────────────────────────

export interface BankonRecord {
  processId: string;
  owner: string;
  type: 'lease' | 'permabuy';
  startTimestamp: number;
  endTimestamp?: number;
  undernameLimit: number;
  purchasePrice?: string;
  paymentMethod: PaymentMethod;
  target?: string;
  ttlSeconds: number;
  undernames: Record<string, { transactionId: string; ttlSeconds: number }>;
}

export interface ReservedBankonName {
  target?: string;
  endTimestamp?: number;
  reason?: string;
}

export interface BankonResolveResult {
  target?: string;
  ttlSeconds: number;
  undernames: Record<string, { transactionId: string; ttlSeconds: number }>;
  owner: string;
  type: 'lease' | 'permabuy';
  endTimestamp?: number;
}

export type ClaimIntent = 'Buy-Name' | 'Extend-Lease' | 'Upgrade-Name' | 'Primary-Name-Request' | 'Increase-Undername-Limit';

// ── Guards ───────────────────────────────────────────────────

function requireConfigured(): void {
  if (!isBnrConfigured()) {
    // Wallet users can't run a CLI — point them at the in-wallet spawn flow.
    throw new Error('BANKON Names Registry not yet spawned. Open the BANKON tile on the dashboard and choose “Setup” to spawn it.');
  }
}

// ── Reads (dry-run) ─────────────────────────────────────────

export async function getBankonRecord(name: string): Promise<BankonRecord | null> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Record' },
      { name: 'Name', value: name },
    ],
  });
  return parseJsonOrNull<BankonRecord>(res);
}

export async function getReservedBankonName(name: string): Promise<ReservedBankonName | null> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Reserved-Name' },
      { name: 'Name', value: name },
    ],
  });
  return parseJsonOrNull<ReservedBankonName>(res);
}

export async function resolveBankon(name: string): Promise<BankonResolveResult | null> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Resolve' },
      { name: 'Name', value: name },
    ],
  });
  return parseJsonOrNull<BankonResolveResult>(res);
}

export async function getOwnedBankonRecords(owner: string): Promise<{ name: string; record: BankonRecord }[]> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Get-Owned-Records' },
      { name: 'Owner', value: owner },
    ],
  });
  const data = readData(res);
  if (!data) return [];
  try {
    return JSON.parse(data) as { name: string; record: BankonRecord }[];
  } catch {
    return [];
  }
}

export interface TokenCostOpts {
  paymentMethod: PaymentMethod;
  years?: number;
  purchaseType?: 'lease' | 'permabuy';
}

export async function getBankonTokenCost(
  intent: ClaimIntent,
  name: string,
  opts: TokenCostOpts,
): Promise<{ method: PaymentMethod; amount: bigint; unit: string }> {
  requireConfigured();
  const tags: DataItemTag[] = [
    { name: 'Action', value: 'Token-Cost' },
    { name: 'Intent', value: intent },
    { name: 'Name', value: name },
    { name: 'Payment-Method', value: opts.paymentMethod },
  ];
  if (opts.purchaseType) tags.push({ name: 'Purchase-Type', value: opts.purchaseType });
  if (opts.years !== undefined) tags.push({ name: 'Years', value: String(opts.years) });

  const res = await aoDryRun({ process: getBnrProcessId(), tags });
  const data = readData(res);
  const cleaned = (data ?? '0').trim().replace(/^"|"$/g, '');
  const amount = /^\d+$/.test(cleaned) ? BigInt(cleaned) : 0n;
  return { method: opts.paymentMethod, amount, unit: paymentMethodUnit(opts.paymentMethod) };
}

export async function getPrimaryBankonName(owner: string): Promise<string | null> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Get-Primary-Name' },
      { name: 'Owner', value: owner },
    ],
  });
  const parsed = parseJsonOrNull<{ owner: string; name: string }>(res);
  return parsed?.name ?? null;
}

// ── Writes (returns DataItemInput; caller signs + posts) ────

export interface BuyBankonOpts {
  name: string;
  purchaseType: 'lease' | 'permabuy';
  years?: number;
  payment: PaymentProof;
  undernameLimit?: number;
}

export function buildBuyBankonInput(opts: BuyBankonOpts): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  const tags: DataItemTag[] = [
    { name: 'Action', value: 'Buy-Name' },
    { name: 'Name', value: opts.name },
    { name: 'Purchase-Type', value: opts.purchaseType },
    ...paymentProofToTags(opts.payment),
  ];
  if (opts.purchaseType === 'lease') {
    tags.push({ name: 'Years', value: String(opts.years ?? 1) });
  }
  if (opts.undernameLimit !== undefined) {
    tags.push({ name: 'Undername-Limit', value: String(opts.undernameLimit) });
  }
  return buildAoMessageInput({ process: getBnrProcessId(), tags });
}

export function buildTransferBankonInput(opts: { name: string; to: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Transfer' },
      { name: 'Name', value: opts.name },
      { name: 'Recipient', value: opts.to },
    ],
  });
}

export function buildSetBankonRecordInput(opts: {
  name: string;
  subdomain: string;
  transactionId: string;
  ttlSeconds?: number;
}): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Set-Record' },
      { name: 'Name', value: opts.name },
      { name: 'Sub-Domain', value: opts.subdomain },
      { name: 'Transaction-Id', value: opts.transactionId },
      { name: 'TTL-Seconds', value: String(opts.ttlSeconds ?? 3600) },
    ],
  });
}

export function buildExtendBankonLeaseInput(opts: {
  name: string;
  years: number;
  payment: PaymentProof;
}): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Extend-Lease' },
      { name: 'Name', value: opts.name },
      { name: 'Years', value: String(opts.years) },
      ...paymentProofToTags(opts.payment),
    ],
  });
}

export function buildPrimaryBankonRequestInput(opts: { name: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Primary-Name-Request' },
      { name: 'Name', value: opts.name },
    ],
  });
}

export function buildPrimaryBankonAcknowledgeInput(): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags: [{ name: 'Action', value: 'Primary-Name-Acknowledge' }],
  });
}

// ── Governance builders (controller-only on the registry side) ─

export interface BnrInfo {
  name: string;
  version: string;
  recordCount: number;
  reservedCount: number;
  controllers: string[];
  policy: {
    OpenBeta: boolean;
    LeaseYearsMin: number;
    LeaseYearsMax: number;
    DefaultLeaseYears: number;
    UndernameLimitDefault: number;
    RootTtlSecondsDefault: number;
    AcceptedMethods: string[];
    Costs?: Record<string, Record<string, Record<string, string>>>;
  };
  treasury: Record<string, string>;
}

/** Fetch the BNR's Info handler — used by the admin view to surface policy
 * and controller membership. Returns null if the registry is unreachable. */
export async function getBnrInfo(): Promise<BnrInfo | null> {
  requireConfigured();
  const res = await aoDryRun({
    process: getBnrProcessId(),
    tags: [{ name: 'Action', value: 'Info' }],
  });
  return parseJsonOrNull<BnrInfo>(res);
}

export interface SetPolicyOpts {
  openBeta?: boolean;
  leaseYearsMin?: number;
  leaseYearsMax?: number;
  defaultLeaseYears?: number;
  undernameLimitDefault?: number;
  rootTtlSecondsDefault?: number;
  acceptedMethods?: string[];
}

/** Build a controller-only Set-Policy message. The flat tag overrides take
 * precedence over the JSON body on the BNR side, so we encode each field
 * as a tag when present. */
export function buildSetPolicyInput(opts: SetPolicyOpts): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  const tags: DataItemTag[] = [{ name: 'Action', value: 'Set-Policy' }];
  if (opts.openBeta !== undefined) tags.push({ name: 'OpenBeta', value: opts.openBeta ? 'true' : 'false' });
  if (opts.leaseYearsMin !== undefined) tags.push({ name: 'LeaseYearsMin', value: String(opts.leaseYearsMin) });
  if (opts.leaseYearsMax !== undefined) tags.push({ name: 'LeaseYearsMax', value: String(opts.leaseYearsMax) });
  // Anything not representable in a single tag goes through the JSON body.
  const body: Record<string, unknown> = {};
  if (opts.defaultLeaseYears !== undefined) body.DefaultLeaseYears = opts.defaultLeaseYears;
  if (opts.undernameLimitDefault !== undefined) body.UndernameLimitDefault = opts.undernameLimitDefault;
  if (opts.rootTtlSecondsDefault !== undefined) body.RootTtlSecondsDefault = opts.rootTtlSecondsDefault;
  if (opts.acceptedMethods !== undefined) body.AcceptedMethods = opts.acceptedMethods;
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags,
    data: Object.keys(body).length > 0 ? JSON.stringify(body) : '',
  });
}

export function buildSetTreasuryInput(opts: { paymentMethod: PaymentMethod; address: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Set-Treasury' },
      { name: 'Payment-Method', value: opts.paymentMethod },
      { name: 'Address', value: opts.address },
    ],
  });
}

export function buildAddControllerInput(opts: { address: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Add-Controller' },
      { name: 'Address', value: opts.address },
    ],
  });
}

export function buildRemoveControllerInput(opts: { address: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Remove-Controller' },
      { name: 'Address', value: opts.address },
    ],
  });
}

export function buildSetReservedInput(opts: { name: string; target?: string; reason?: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  const tags: DataItemTag[] = [
    { name: 'Action', value: 'Set-Reserved' },
    { name: 'Name', value: opts.name },
  ];
  if (opts.target) tags.push({ name: 'Target', value: opts.target });
  if (opts.reason) tags.push({ name: 'Reason', value: opts.reason });
  return buildAoMessageInput({ process: getBnrProcessId(), tags });
}

export function buildClearReservedInput(opts: { name: string }): Omit<DataItemInput, 'owner'> {
  requireConfigured();
  return buildAoMessageInput({
    process: getBnrProcessId(),
    tags: [
      { name: 'Action', value: 'Clear-Reserved' },
      { name: 'Name', value: opts.name },
    ],
  });
}

// ── Internals ────────────────────────────────────────────────

function readData(out: AoMessageOutput): string | null {
  const data = (out as unknown as { Data?: unknown }).Data;
  if (data == null) return null;
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'bigint') return data.toString();
  try { return JSON.stringify(data); } catch { return null; }
}

function parseJsonOrNull<T>(out: AoMessageOutput): T | null {
  const data = readData(out);
  if (!data || data === 'null') return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
