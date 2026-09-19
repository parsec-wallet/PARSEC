// Parsec x402 — the Algorand rail, scheme `exact`.
//
// The shape the facilitators actually expect (spec `schemes/exact/scheme_exact_algo.md`,
// reference client `@x402/avm`):
//
//   paymentGroup[0]  fee payer   pay  feePayer → feePayer, 0 µALGO, fee = whole group's
//                                     fee, transmitted UNSIGNED — the facilitator signs
//                                     it at settlement, which is what makes the payment
//                                     gasless for the participant.
//   paymentGroup[1]  payment     axfer payer → payTo, `amount` atomic units of `asset`,
//                                     fee 0, signed here. `paymentIndex` points at it.
//
// With no `extra.feePayer` the group is the single payment transaction at index 0 and
// the payer pays its own fee.
//
// Signing goes through Rust (`chain_algo_sign_transaction`): the transaction is built
// here, `bytesToSign()` hands Rust the exact `TX`-prefixed preimage, and a signature
// comes back. The mnemonic never enters the renderer — which the previous x402 path,
// retrieving it through `keystoreRetrieve`, could not say.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import algosdk from 'algosdk';
import { algoSignTransaction } from '../../chain-algo';
import { getAlgodClient, getIndexerClient } from '../../algorand/client';
import type { NetworkId } from '../../../types/wallet';
import { ALGORAND_MAINNET, ALGORAND_TESTNET, ALGORAND_LOCALNET, describeNetwork } from '../networks';
import { base64ToBytes, bytesToBase64 } from '../protocol';
import { registerRail, type X402Blocker, type X402PaymentContext, type X402Preflight, type X402Rail } from '../rails';

/** Min balance an account must keep, plus one asset holding, in microALGO. */
const MIN_BALANCE_PER_ASSET = 100_000n;

/** The scheme payload for Algorand `exact`. */
export interface AvmPaymentPayload extends Record<string, unknown> {
  paymentGroup: string[];
  paymentIndex: number;
}

/** Parsec's network selector for a CAIP-2 Algorand id. Localnet has no selector; it reads as testnet. */
export function walletNetworkFor(network: string): NetworkId {
  const d = describeNetwork(network);
  return d.walletNetwork ?? 'testnet';
}

/**
 * Build the atomic group.
 *
 * Fees are computed the way the protocol charges them: per transaction,
 * `max(feePerByte × size, minFee)`, summed onto the fee payer and zeroed everywhere
 * else. When `sp.fee` is 0 — the normal, uncongested case — that reduces to
 * `minFee × n`, the familiar 2,000 µALGO for a two-transaction group.
 */
export async function buildPaymentGroup(ctx: X402PaymentContext): Promise<{
  group: algosdk.Transaction[];
  paymentIndex: number;
}> {
  const { requirement, payer } = ctx;
  const client = getAlgodClient(ctx.walletNetwork);
  const sp = await client.getTransactionParams().do();
  const feePayer = typeof requirement.extra?.feePayer === 'string' ? requirement.extra.feePayer : '';
  const amount = BigInt(requirement.amount);
  const assetId = BigInt(requirement.asset || '0');
  const stamp = Date.now();

  const withFee = (fee: number | bigint): algosdk.SuggestedParams => ({ ...sp, flatFee: true, fee: BigInt(fee) });

  /** The payment leg — `axfer` for an ASA, `pay` for native ALGO. */
  const makePayment = (params: algosdk.SuggestedParams): algosdk.Transaction =>
    assetId === 0n
      ? algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: payer,
          receiver: requirement.payTo,
          amount,
          note: new TextEncoder().encode(`x402-payment-v${ctx.challenge.x402Version}-${stamp}`),
          suggestedParams: params,
        })
      : algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: payer,
          receiver: requirement.payTo,
          assetIndex: assetId,
          amount,
          note: new TextEncoder().encode(`x402-payment-v${ctx.challenge.x402Version}-${stamp}`),
          suggestedParams: params,
        });

  if (!feePayer) {
    // The payer covers their own fee; algosdk's suggested params are already right.
    return { group: [makePayment(sp)], paymentIndex: 0 };
  }

  const makeFeePayer = (fee: number | bigint): algosdk.Transaction =>
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: feePayer,
      receiver: feePayer,
      amount: 0,
      note: new TextEncoder().encode(`x402-fee-payer-${stamp}`),
      suggestedParams: withFee(fee),
    });

  // Size first, fee second: measure the group as built, then charge it to index 0.
  const draft = [makeFeePayer(0), makePayment(withFee(0))];
  const feePerByte = Number(sp.fee ?? 0n);
  const minFee = Number(sp.minFee ?? 1000n);
  const totalFee = draft.reduce((sum, txn) => {
    const size = algosdk.encodeUnsignedTransaction(txn).length;
    return sum + (feePerByte > 0 ? Math.max(feePerByte * size, minFee) : minFee);
  }, 0);

  const group = algosdk.assignGroupID([makeFeePayer(totalFee), makePayment(withFee(0))]);
  return { group, paymentIndex: 1 };
}

/**
 * Sign every transaction in the group whose sender is the payer, through Rust.
 *
 * Transactions the payer does not own — the fee payer's — travel unsigned, as raw
 * transaction bytes. The facilitator signs its own before submitting; signing it here
 * would be both impossible and, if it were possible, an authority the client should
 * never hold.
 */
export async function signPaymentGroup(
  group: algosdk.Transaction[],
  payer: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const txn of group) {
    if (txn.sender.toString() !== payer) {
      out.push(bytesToBase64(algosdk.encodeUnsignedTransaction(txn)));
      continue;
    }
    const { signature_b64 } = await algoSignTransaction(payer, bytesToBase64(txn.bytesToSign()));
    out.push(bytesToBase64(txn.attachSignature(payer, base64ToBytes(signature_b64))));
  }
  return out;
}

/**
 * What would stop this payment, read from chain before anything is signed.
 *
 * Two things reliably do: the payer holds less of the asset than the quote, or — the
 * Algorand-specific one — has never opted in to it, in which case the transfer is
 * rejected by the protocol rather than failing for want of funds. Both are reported;
 * the opt-in carries a remedy the wallet can run.
 */
export async function preflightAvm(ctx: X402PaymentContext): Promise<X402Preflight> {
  const { requirement, payer } = ctx;
  const blockers: X402Blocker[] = [];
  if (!payer) {
    return { ok: false, blockers: [{ code: 'no-account', message: 'No Algorand account selected.' }] };
  }

  const assetId = Number(requirement.asset || '0');
  const amount = BigInt(requirement.amount);
  let balance: bigint | undefined;

  try {
    const client = getAlgodClient(ctx.walletNetwork);
    const info = (await client.accountInformation(payer).do()) as unknown as {
      amount: bigint | number;
      assets?: Array<{ assetId: bigint | number; amount: bigint | number }>;
    };
    if (assetId === 0) {
      // Native ALGO: what is spendable is the balance less the minimum the account must keep.
      const held = BigInt(info.amount);
      const reserved = MIN_BALANCE_PER_ASSET * BigInt(1 + (info.assets?.length ?? 0));
      balance = held > reserved ? held - reserved : 0n;
    } else {
      const holding = info.assets?.find((a) => BigInt(a.assetId) === BigInt(assetId));
      if (!holding) {
        blockers.push({
          code: 'not-opted-in',
          message: `Not opted in to ASA ${assetId}. Algorand requires an opt-in before an account can receive or hold an asset, and the holding locks 0.1 ALGO into the account's minimum balance.`,
          remedy: {
            label: `Opt in to ASA ${assetId}`,
            run: async () => { await optInToAsset(payer, assetId, ctx.walletNetwork); },
          },
        });
      } else {
        balance = BigInt(holding.amount);
      }
    }
  } catch (err) {
    blockers.push({ code: 'other', message: `Could not read account state: ${err instanceof Error ? err.message : String(err)}` });
  }

  if (balance !== undefined && balance < amount) {
    blockers.push({
      code: 'insufficient-funds',
      message: `Balance ${balance} is below the quoted ${amount} atomic units.`,
    });
  }

  return { ok: blockers.length === 0, blockers, balance };
}

/** Whether the payer has opted in to an ASA. Cheap enough to call from a view. */
export async function isOptedIn(address: string, assetId: number, network: NetworkId): Promise<boolean> {
  if (assetId === 0) return true;
  try {
    const info = (await getIndexerClient(network)
      .lookupAccountAssets(address)
      .assetId(assetId)
      .do()) as unknown as { assets?: unknown[] };
    return !!info.assets?.length;
  } catch {
    return false;
  }
}

/**
 * Sign one transaction through Rust, submit it, and wait for it to be confirmed.
 *
 * The shared primitive behind every standalone Algorand write this module makes. Signing
 * is the same seam the payment group uses — `bytesToSign()` out, a signature back, the
 * key never in the renderer.
 */
export async function signAndSend(
  address: string,
  txn: algosdk.Transaction,
  network: NetworkId,
  waitRounds = 4,
): Promise<{ txId: string; confirmedRound: number }> {
  const client = getAlgodClient(network);
  const { signature_b64 } = await algoSignTransaction(address, bytesToBase64(txn.bytesToSign()));
  const signed = txn.attachSignature(address, base64ToBytes(signature_b64));
  const { txid } = await client.sendRawTransaction(signed).do();
  const result = await algosdk.waitForConfirmation(client, txid, waitRounds);
  return { txId: txid, confirmedRound: Number(result.confirmedRound ?? 0) };
}

/**
 * Opt in to an ASA: a zero-amount transfer to oneself, Rust-signed and submitted.
 *
 * The cost is not the fee but the 0.1 ALGO the protocol locks into the account's
 * minimum balance for as long as the holding exists — worth saying out loud before
 * a participant opts in to something to spend $0.001.
 */
export async function optInToAsset(
  address: string,
  assetId: number,
  network: NetworkId,
): Promise<{ txId: string; confirmedRound: number }> {
  const suggestedParams = await getAlgodClient(network).getTransactionParams().do();
  return signAndSend(
    address,
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: address,
      receiver: address,
      assetIndex: BigInt(assetId),
      amount: 0,
      suggestedParams,
    }),
    network,
  );
}

/**
 * Send ALGO to an address, Rust-signed, and wait for finality.
 *
 * Not an x402 payment — a plain transfer. It lives here because it is the same signing
 * seam and the same confirmation wait, and because the thing that most wants it is a
 * paid name claim, whose proof is exactly "an Algorand transaction id paying a quoted
 * address".
 */
export async function sendAlgoPayment(
  address: string,
  receiver: string,
  amountMicroAlgos: bigint,
  note: string,
  network: NetworkId,
): Promise<{ txId: string; confirmedRound: number }> {
  const suggestedParams = await getAlgodClient(network).getTransactionParams().do();
  return signAndSend(
    address,
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: address,
      receiver,
      amount: amountMicroAlgos,
      note: note ? new TextEncoder().encode(note) : undefined,
      suggestedParams,
    }),
    network,
  );
}

export const avmRail: X402Rail = {
  family: 'avm',
  label: 'Algorand',
  schemes: ['exact'],
  networks: [ALGORAND_MAINNET, ALGORAND_TESTNET, ALGORAND_LOCALNET],

  async buildPayload(ctx: X402PaymentContext): Promise<AvmPaymentPayload> {
    const { group, paymentIndex } = await buildPaymentGroup(ctx);
    if (group.length > 16) {
      throw new Error(`payment group has ${group.length} transactions; Algorand allows 16`);
    }
    const paymentGroup = await signPaymentGroup(group, ctx.payer);
    return { paymentGroup, paymentIndex };
  },

  preflight: preflightAvm,
};

registerRail(avmRail);
