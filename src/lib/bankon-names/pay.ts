// BANKON Names — paying for a claim, and proving it.
//
// The BNR is token-agnostic: a claim carries `Payment-Method`, `Payment-Proof` and
// `Payment-Amount`, and for `algorand` the proof is simply the id of a transaction that
// paid `BNR.Treasury.algorand`. The registry's verifier wants nothing more exotic than
// that — which is why this file is short, and why it was blocked for so long on
// something that had nothing to do with names: the x402 flow never captured the
// settlement transaction id, so there was no id to hand over.
//
// Two ways to get one, in this order:
//
//   1. **A settlement already in the ledger.** If the participant has paid the treasury
//      over x402 — buying something else from the same address, or paying a name desk
//      endpoint — that receipt is a valid proof and no second payment is owed.
//   2. **A direct payment.** Otherwise, send the quoted microALGO to the treasury,
//      Rust-signed, and wait for finality. Algorand has no forks, so "in a block" is
//      final and the id is immediately good as proof.
//
// Nothing here trusts a quote it did not just fetch, and nothing reuses a receipt that
// paid less than the quote.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import type { NetworkId } from '../../types/wallet';
import { getBnrInfo, getBankonTokenCost } from './client';
import type { ClaimIntent, TokenCostOpts } from './client';
import type { PaymentMethod } from './payment';
import { latestReceiptTo } from '../x402/receipts';
import type { AvmSigner } from '../x402/host';
import { sendAlgoPayment } from '../x402/rails/avm';
import { describeNetwork, toCaip2 } from '../x402/networks';

/** A proof good enough for a `Payment-Method: algorand` claim. */
export interface NameClaimProof {
  method: Extract<PaymentMethod, 'algorand'>;
  /** Algorand transaction id paying the treasury. */
  txId: string;
  /** What was actually paid, in microALGO. */
  amount: bigint;
  /** Where it came from — an existing x402 settlement, or a payment made just now. */
  source: 'x402-receipt' | 'direct';
  treasury: string;
}

/** The registry's own treasury address for a payment method. Read live, never cached. */
export async function treasuryFor(method: PaymentMethod): Promise<string> {
  const info = await getBnrInfo();
  const address = info?.treasury?.[method] ?? '';
  if (!address) {
    throw new Error(
      `The registry has no treasury address for "${method}". A controller must set one before a paid claim can be made.`,
    );
  }
  return address;
}

/**
 * A proof drawn from a settlement already recorded, or null.
 *
 * Only accepted when the recorded amount covers the quote. A receipt for a cheaper
 * purchase to the same treasury is a real payment, but it is not payment for *this*.
 */
export function proofFromReceipts(
  treasury: string,
  quotedMicroAlgos: bigint,
  network: NetworkId,
): NameClaimProof | null {
  const caip2 = toCaip2(network === 'mainnet' ? 'algorand-mainnet' : 'algorand-testnet');
  const receipt = latestReceiptTo(treasury, caip2);
  if (!receipt) return null;
  // The asset has to be ALGO: a USDC payment to the treasury is not what
  // `Payment-Amount` is denominated in, and the registry would read it as a shortfall.
  if (receipt.asset !== '0') return null;
  const paid = BigInt(receipt.amount || '0');
  if (paid < quotedMicroAlgos) return null;
  return { method: 'algorand', txId: receipt.txId, amount: paid, source: 'x402-receipt', treasury };
}

/** Pay the treasury directly and wait for the transaction to be final. */
export async function payTreasury(
  signer: AvmSigner,
  treasury: string,
  microAlgos: bigint,
  name: string,
  network: NetworkId,
): Promise<NameClaimProof> {
  if (microAlgos <= 0n) throw new Error('A paid claim needs a positive quote.');
  const caip2 = network === 'mainnet' ? 'algorand-mainnet' : 'algorand-testnet';
  const { txId } = await sendAlgoPayment(signer, treasury, microAlgos, `bnr:claim:${name}`, caip2);
  return { method: 'algorand', txId, amount: microAlgos, source: 'direct', treasury };
}

export interface NameClaimQuote {
  treasury: string;
  amount: bigint;
  unit: string;
  networkLabel: string;
  /** A settlement already on file that would satisfy this quote, if there is one. */
  existing: NameClaimProof | null;
}

/**
 * What this claim costs, where it is paid, and whether it has already been paid.
 *
 * Everything a confirmation surface needs, with nothing signed. `existing` being
 * non-null is the case worth showing loudly: the participant owes nothing.
 */
export async function quoteNameClaim(
  intent: ClaimIntent,
  name: string,
  opts: TokenCostOpts,
  network: NetworkId,
): Promise<NameClaimQuote> {
  const [treasury, cost] = await Promise.all([
    treasuryFor(opts.paymentMethod),
    getBankonTokenCost(intent, name, opts),
  ]);
  return {
    treasury,
    amount: cost.amount,
    unit: cost.unit,
    networkLabel: describeNetwork(network === 'mainnet' ? 'algorand-mainnet' : 'algorand-testnet').label,
    existing: opts.paymentMethod === 'algorand' ? proofFromReceipts(treasury, cost.amount, network) : null,
  };
}

/**
 * Produce a proof for a claim, paying only if one is not already on file.
 *
 * Returns what `NamespaceAdapter.claim()` wants: `paymentProof` and `paymentAmount`.
 */
export async function proveNameClaimPayment(
  signer: AvmSigner,
  quote: NameClaimQuote,
  name: string,
  network: NetworkId,
): Promise<NameClaimProof> {
  if (quote.existing) return quote.existing;
  return payTreasury(signer, quote.treasury, quote.amount, name, network);
}
