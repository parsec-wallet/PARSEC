// PARSEC Wallet — Arweave uploads paid over x402, from the person's own wallet.
//
// Turbo (ar.io's bundler) takes payment per upload over x402: the first POST of a signed data
// item answers 402 with a quote in USDC on Base, the second carries an EIP-3009 authorization
// signed by the PARSEC Keycore, and Turbo settles it and stores the item. Nobody holds the
// person's money or keys; there are no Turbo credits to buy first.
//
// BANKON facilitates: its fee (10 %, at least $0.05, lib/bankon-fee.ts) is paid first, once
// for the whole upload, as its own x402 payment to mindX — which computes it from Turbo's
// public prices, and is refused here if it asks more than this wallet computed.
//
// Every payment is checked before it is signed, even under an auto-approve cap: the right
// network and asset, and within the budget the person approved for this upload.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { x402Request } from '../x402/client';
import { BASE_MAINNET, sameNetwork } from '../x402/networks';
import type { X402Signers } from '../x402/host';
import { TURBO_UPLOAD_URL, TurboError, type TurboReceipt } from './turbo';

export const TURBO_X402_UPLOAD_URL = `${TURBO_UPLOAD_URL}/v1/x402/data-item/signed`;
export const BANKON_UPLOAD_FEE_URL = 'https://mindx.pythai.net/permaweb/fee';
export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

/** A budget for one upload: the most, in micro-USD, its Turbo payments may add up to. */
export class UploadBudget {
  private spent = 0n;
  constructor(readonly limitMicro: bigint) {}
  get spentMicro(): bigint { return this.spent; }
  /** Reserve `amount` or throw: nothing past the approved figure is ever signed. */
  take(amount: bigint): void {
    if (this.spent + amount > this.limitMicro) {
      throw new TurboError(
        `Turbo asked $${fmt(amount)} for this item; with $${fmt(this.spent)} already paid that passes the $${fmt(this.limitMicro)} you approved. Nothing more was paid.`,
        402,
      );
    }
    this.spent += amount;
  }
  /** Give back a reservation whose payment did not go out. */
  release(amount: bigint): void { this.spent -= amount; }
}

export interface X402Paid {
  itemId: string;
  amountMicro: bigint;
  /** The Base settlement transaction, when Turbo reports it. */
  txHash: string | null;
}

/** Post one signed data item to Turbo, paying over x402 within `budget`. */
export async function postDataItemX402(
  raw: Uint8Array,
  signers: X402Signers,
  budget: UploadBudget,
  onPaid: (p: X402Paid) => void = () => {},
): Promise<TurboReceipt> {
  let reserved = 0n;
  const result = await x402Request(TURBO_X402_UPLOAD_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: raw as unknown as BodyInit,
  }, {
    signers,
    preferNetwork: BASE_MAINNET,
    sendPayerHint: false,
    approve: async () => true, // the person approved the budget on the upload screen
    verify: (pending) => {
      const r = pending.requirement;
      if (!sameNetwork(r.network, BASE_MAINNET)) throw new TurboError(`Turbo offered payment on ${r.network}, not Base. Nothing was paid.`, 402);
      if (r.asset.toLowerCase() !== BASE_USDC) throw new TurboError('Turbo asked for an asset other than USDC on Base. Nothing was paid.', 402);
      if (!/^\d+$/.test(r.amount)) throw new TurboError('Turbo sent an unreadable price. Nothing was paid.', 402);
      reserved = BigInt(r.amount);
      budget.take(reserved);
    },
  }).catch((e: unknown) => {
    if (reserved) budget.release(reserved);
    throw e;
  });

  const res = result.response;
  if (!result.success || !res) {
    if (reserved && !result.txId) budget.release(reserved);
    throw new TurboError(`Turbo did not store the item: ${result.error ?? 'no response'}`, res?.status ?? 0);
  }
  const text = await res.clone().text();
  let j: Record<string, unknown>;
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { throw new TurboError('Turbo upload: response was not JSON', res.status); }
  if (typeof j.id !== 'string') throw new TurboError('Turbo upload: response had no id', res.status);
  const pay = (j.x402Payment ?? {}) as { txHash?: unknown };
  onPaid({ itemId: j.id, amountMicro: reserved, txHash: typeof pay.txHash === 'string' ? pay.txHash : result.txId ?? null });
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    id: j.id,
    owner: typeof j.owner === 'string' ? j.owner : '',
    winc: typeof j.winc === 'string' ? j.winc : '0',
    dataCaches: list(j.dataCaches),
    fastFinalityIndexes: list(j.fastFinalityIndexes),
    timestamp: typeof j.timestamp === 'number' ? j.timestamp : undefined,
    deadlineHeight: typeof j.deadlineHeight === 'number' ? j.deadlineHeight : undefined,
  };
}

/**
 * Pay the BANKON facilitation fee for an upload (once, before the paid items).
 * `expectedMicro` is this wallet's own computation; a fee above it (plus a sliver for prices
 * moving between the two reads) is refused before signing.
 */
export async function payUploadFee(
  paidItemSizes: readonly number[],
  signers: X402Signers,
  expectedMicro: bigint,
  preferNetwork: string = BASE_MAINNET,
): Promise<{ txId: string; feeMicro: bigint }> {
  const ceiling = expectedMicro + expectedMicro / 20n + 1_000n; // +5 % and a tenth of a cent
  let asked = 0n;
  const result = await x402Request(BANKON_UPLOAD_FEE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sizes: paidItemSizes }),
  }, {
    signers,
    preferNetwork,
    approve: async () => true,
    verify: (pending) => {
      const amount = pending.quote.amountAtomic;
      if (pending.quote.usdMicro === null) throw new Error('The BANKON fee was not offered in a dollar stablecoin. Nothing was paid.');
      if (pending.quote.usdMicro > ceiling) {
        throw new Error(`The BANKON fee asked ($${fmt(pending.quote.usdMicro)}) is more than this wallet computed ($${fmt(expectedMicro)}). Nothing was paid.`);
      }
      asked = amount;
    },
  });
  if (!result.success || !result.txId) throw new Error(result.error || 'The BANKON fee did not settle.');
  return { txId: result.txId, feeMicro: asked };
}

function fmt(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac.padEnd(2, '0')}` : '.00'}`;
}
