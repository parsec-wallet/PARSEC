// AR.IO Network Process helpers — narrow surface focused on the actions
// Parsec needs in May 2026 (pre-Solana migration): read balance / record /
// price, build Buy-Name DataItems, and tag-up registry messages.
//
// All reads route through aoDryRun against ARIO_MAINNET_PROCESS; the CU
// at cu.ardrive.io is the canonical AR.IO compute unit. Writes (Buy-Name,
// Transfer) return a DataItemInput that the caller signs via
// signDataItemFromVault + aoMessage.
//
// Spec sources:
//   * https://docs.ar.io  (Token + ArNS docs)
//   * ar-io/ar-io-sdk     (canonical TS SDK — io.ts handlers)

import type { DataItemInput, DataItemTag } from './ans104';
import { aoDryRun, buildAoMessageInput, type AoMessageOutput } from './ao';

export const ARIO_MAINNET_PROCESS = 'qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE';
export const ARIO_TESTNET_PROCESS = 'agYcCFJtrMG6cqMuZfskIkFTGvUPddICmtQSBIoPdiA';
export const ANT_REGISTRY_MAINNET = 'i_le_yKKPVstLTDSmkHRqf-wYphMnwB9OhleiTgMkWc';
export const ANT_REGISTRY_TESTNET = 'RR0vheYqtsKuJCWh6xj0beE35tjaEug5cejMw9n2aa8';
export const DEFAULT_SCHEDULER = '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA';
export const AO_AUTHORITY = 'fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY';

/** 1 ARIO = 1,000,000 mARIO (6 decimals). */
export const ARIO_DECIMALS = 6;
export const MARIO_PER_ARIO = 1_000_000n;

// ── Read paths (dry-run) ─────────────────────────────────────

/** mARIO balance of an address. Returns 0n if the wallet has no record. */
export async function getArioBalance(address: string): Promise<bigint> {
  const res = await aoDryRun({
    process: ARIO_MAINNET_PROCESS,
    tags: [
      { name: 'Action', value: 'Balance' },
      { name: 'Recipient', value: address },
    ],
  });
  return parseDataAsBigInt(res);
}

export interface ArnsRecord {
  processId: string;
  type: 'lease' | 'permabuy';
  startTimestamp: number;
  endTimestamp?: number;
  undernameLimit?: number;
  purchasePrice?: bigint;
}

/** Lookup a name. Returns null if the name is unregistered. */
export async function getArnsRecord(name: string): Promise<ArnsRecord | null> {
  const res = await aoDryRun({
    process: ARIO_MAINNET_PROCESS,
    tags: [
      { name: 'Action', value: 'Record' },
      { name: 'Name', value: name },
    ],
  });
  const data = readData(res);
  if (!data || data === 'null') return null;
  try {
    const parsed = JSON.parse(data) as Partial<ArnsRecord> & { processId?: string };
    if (!parsed.processId) return null;
    return parsed as ArnsRecord;
  } catch {
    return null;
  }
}

/** Lookup if a name is reserved (e.g. premium auctions). null = not reserved. */
export async function getReservedName(name: string): Promise<{ target?: string; endTimestamp?: number } | null> {
  const res = await aoDryRun({
    process: ARIO_MAINNET_PROCESS,
    tags: [
      { name: 'Action', value: 'Reserved-Name' },
      { name: 'Name', value: name },
    ],
  });
  const data = readData(res);
  if (!data || data === 'null') return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export interface TokenCostOpts {
  years?: number;
  purchaseType?: 'lease' | 'permabuy';
  quantity?: number;
}

/** Get the mARIO cost for an Intent + name. */
export async function getTokenCost(
  intent: 'Buy-Name' | 'Extend-Lease' | 'Upgrade-Name' | 'Primary-Name-Request' | 'Increase-Undername-Limit',
  name: string,
  opts: TokenCostOpts = {},
): Promise<bigint> {
  const tags: DataItemTag[] = [
    { name: 'Action', value: 'Token-Cost' },
    { name: 'Intent', value: intent },
    { name: 'Name', value: name },
  ];
  if (opts.years !== undefined) tags.push({ name: 'Years', value: String(opts.years) });
  if (opts.purchaseType) tags.push({ name: 'Purchase-Type', value: opts.purchaseType });
  if (opts.quantity !== undefined) tags.push({ name: 'Quantity', value: String(opts.quantity) });

  const res = await aoDryRun({
    process: ARIO_MAINNET_PROCESS,
    tags,
  });
  return parseDataAsBigInt(res);
}

// ── Write paths (DataItemInput; caller signs + posts) ────────

export interface BuyNameOpts {
  name: string;
  antProcessId: string;
  purchaseType: 'lease' | 'permabuy';
  years?: number;                   // required when purchaseType === 'lease'
  fundFrom?: 'balance' | 'turbo';
  referrer?: string;
}

/** Build the AO message to claim an ArNS name. Target = AR.IO Registry. */
export function buildBuyNameInput(opts: BuyNameOpts): Omit<DataItemInput, 'owner'> {
  const extra: DataItemTag[] = [
    { name: 'Action', value: 'Buy-Name' },
    { name: 'Name', value: opts.name },
    { name: 'Process-Id', value: opts.antProcessId },
    { name: 'Purchase-Type', value: opts.purchaseType },
  ];
  if (opts.purchaseType === 'lease') {
    const years = opts.years ?? 1;
    if (years < 1 || years > 5) {
      throw new Error('Buy-Name lease years must be 1-5');
    }
    extra.push({ name: 'Years', value: String(years) });
  }
  if (opts.fundFrom) extra.push({ name: 'Fund-From', value: opts.fundFrom });
  if (opts.referrer) extra.push({ name: 'Referrer', value: opts.referrer });

  return buildAoMessageInput({
    process: ARIO_MAINNET_PROCESS,
    tags: extra,
  });
}

export interface TransferArioOpts {
  recipient: string;
  /** mARIO amount (1 ARIO = 1,000,000 mARIO). */
  quantity: bigint;
}

export function buildTransferArioInput(opts: TransferArioOpts): Omit<DataItemInput, 'owner'> {
  return buildAoMessageInput({
    process: ARIO_MAINNET_PROCESS,
    tags: [
      { name: 'Action', value: 'Transfer' },
      { name: 'Recipient', value: opts.recipient },
      { name: 'Quantity', value: opts.quantity.toString() },
    ],
  });
}

// ── Owned-records lookup ────────────────────────────────────

/**
 * List ArNS records owned by an address. AR.IO's Registry indexes records
 * by name, not by owner, so we sweep `Paginated-Records` and filter by
 * each ANT's owner field. Stops once `hasMore` is false.
 *
 * For a wallet with a handful of names this is fine; tens of thousands of
 * names would warrant a dedicated indexer (v2). At time of writing the
 * AR.IO namespace has ~thousands of records so a single sweep finishes
 * within a few CU queries.
 */
export async function getOwnedArnsRecords(owner: string): Promise<{ name: string; record: ArnsRecord }[]> {
  const owned: { name: string; record: ArnsRecord }[] = [];
  // Resolve ANT.Owner in parallel batches to keep the wall-clock reasonable.
  // We pull the records list page-by-page; for each batch we kick off
  // ANT-side getAntInfo lookups concurrently and keep those whose owner
  // matches.
  const { getAntInfo } = await import('./ant');

  let cursor = '';
  const PAGE = 100;
  while (true) {
    const res = await aoDryRun({
      process: ARIO_MAINNET_PROCESS,
      tags: [
        { name: 'Action', value: 'Paginated-Records' },
        { name: 'Limit', value: String(PAGE) },
        ...(cursor ? [{ name: 'Cursor', value: cursor }] : []),
      ],
    });
    const data = readData(res);
    if (!data) break;
    let page: { items: { name: string; record: ArnsRecord }[]; nextCursor?: string; hasMore?: boolean };
    try {
      page = JSON.parse(data);
    } catch {
      break;
    }
    const items = page.items ?? [];
    const checks = items.map(async (it) => {
      try {
        const info = await getAntInfo(it.record.processId);
        return info.owner === owner ? it : null;
      } catch {
        return null;
      }
    });
    const resolved = await Promise.all(checks);
    for (const r of resolved) {
      if (r) owned.push(r);
    }
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return owned;
}

/**
 * Compose `getArnsRecord` + an ANT.Info dry-run. Returns null if the name
 * is unregistered. Used by the ario-name view to populate every field of
 * the management panel in one shot.
 */
export async function getArnsName(name: string): Promise<{ record: ArnsRecord; antInfo: import('./ant').AntInfo } | null> {
  const rec = await getArnsRecord(name);
  if (!rec) return null;
  const { getAntInfo } = await import('./ant');
  const antInfo = await getAntInfo(rec.processId);
  return { record: rec, antInfo };
}

/** Returns the primary name registered to `owner`, or null if none. */
export async function getPrimaryArnsName(owner: string): Promise<string | null> {
  const res = await aoDryRun({
    process: ARIO_MAINNET_PROCESS,
    tags: [
      { name: 'Action', value: 'Get-Primary-Name' },
      { name: 'Address', value: owner },
    ],
  });
  const data = readData(res);
  if (!data || data === 'null') return null;
  try {
    const parsed = JSON.parse(data) as { name?: string };
    return parsed.name ?? null;
  } catch {
    return null;
  }
}

// ── Lease + primary + undername write builders ──────────────

export function buildExtendArnsLeaseInput(opts: { name: string; years: number; fundFrom?: 'balance' | 'turbo' }): Omit<DataItemInput, 'owner'> {
  if (opts.years < 1 || opts.years > 5) {
    throw new Error('Extend-Lease years must be 1-5');
  }
  const tags: DataItemTag[] = [
    { name: 'Action', value: 'Extend-Lease' },
    { name: 'Name', value: opts.name },
    { name: 'Years', value: String(opts.years) },
  ];
  if (opts.fundFrom) tags.push({ name: 'Fund-From', value: opts.fundFrom });
  return buildAoMessageInput({ process: ARIO_MAINNET_PROCESS, tags });
}

export function buildPrimaryArnsRequestInput(opts: { name: string }): Omit<DataItemInput, 'owner'> {
  return buildAoMessageInput({
    process: ARIO_MAINNET_PROCESS,
    tags: [
      { name: 'Action', value: 'Primary-Name-Request' },
      { name: 'Name', value: opts.name },
    ],
  });
}

export function buildIncreaseUndernameLimitInput(opts: { name: string; quantity: number; fundFrom?: 'balance' | 'turbo' }): Omit<DataItemInput, 'owner'> {
  if (opts.quantity < 1) {
    throw new Error('Increase-Undername-Limit quantity must be >= 1');
  }
  const tags: DataItemTag[] = [
    { name: 'Action', value: 'Increase-Undername-Limit' },
    { name: 'Name', value: opts.name },
    { name: 'Quantity', value: String(opts.quantity) },
  ];
  if (opts.fundFrom) tags.push({ name: 'Fund-From', value: opts.fundFrom });
  return buildAoMessageInput({ process: ARIO_MAINNET_PROCESS, tags });
}

// ── Unit conversion ─────────────────────────────────────────

/** Convert mARIO bigint to a human ARIO string (e.g. 8242020000n → "8242.02"). */
export function formatArio(microArio: bigint): string {
  const whole = microArio / MARIO_PER_ARIO;
  const fractional = microArio % MARIO_PER_ARIO;
  if (fractional === 0n) return whole.toString();
  const frac = fractional.toString().padStart(ARIO_DECIMALS, '0').replace(/0+$/, '');
  return `${whole}.${frac}`;
}

/** Parse an ARIO string ("8242.02") to mARIO bigint. */
export function parseArio(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error('ARIO amount must be a number with at most 6 decimal places');
  }
  const [whole, fractional = ''] = trimmed.split('.');
  const padded = (fractional + '000000').slice(0, ARIO_DECIMALS);
  return BigInt(whole) * MARIO_PER_ARIO + BigInt(padded);
}

// ── Internals ────────────────────────────────────────────────

function readData(out: AoMessageOutput): string | null {
  const data = (out as unknown as { Data?: unknown }).Data;
  if (data == null) return null;
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'bigint') return data.toString();
  try { return JSON.stringify(data); } catch { return null; }
}

function parseDataAsBigInt(out: AoMessageOutput): bigint {
  const data = readData(out);
  if (!data) return 0n;
  // Strip quotes if the CU returns the number wrapped in JSON quotes.
  const cleaned = data.trim().replace(/^"|"$/g, '');
  if (!/^\d+$/.test(cleaned)) {
    throw new Error(`Expected numeric data, got "${cleaned.slice(0, 40)}"`);
  }
  return BigInt(cleaned);
}
