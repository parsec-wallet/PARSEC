// Lease renewal for V3 (leased) NFDs.
//
// `@txnlab/nfd-sdk` 1.0.0 exposes no renew method, but the NFDInstance
// ARC-56 contract does — `renew(pay)void` plus the readonly
// `getRenewPrice()uint64`. Both are hand-rolled here the same way
// `segmentLock` is in ./segments.ts.
//
// Contract semantics, confirmed from the ABI description embedded in the
// generated client (reference/txnlab/nfd-sdk/.../NFDInstanceClient.ts):
//
//   * `renew` takes ONE payment transaction (immediately preceding the app
//     call, paid to the instance app's address) and extends the expiration
//     "by the time specified (minimum 1 yr) (365 / price paid * mint
//     price)". Days added = 365 × amountPaid ÷ getRenewPrice(). So a single
//     call buys N years by paying N × getRenewPrice() — no per-year loop.
//   * "Expirations can never be more than NFD_MAX_EXPIRATION_DAYS days in the
//     future" — 20 years. The contract asserts on the TOTAL, so a name with
//     time left cannot always take the full 20; the UI says so.
//   * On a permanent V1/V2 name (expirationTime == 0) `renew` CONVERTS it
//     into a leased V3 name (the `curExpiration === 0` branch). Never offer
//     Renew on a permanent name — the manage view hides it for those.
//   * An expired name: the owner takes it back at base price; anyone else
//     pays a reverse-auction price. This module serves the owner only.
//
// Resource references: `renew` reaches into the NFD Registry app and the
// treasury / commission accounts. algosdk's composer does not auto-populate
// those (AlgoKit's `populateAppCallResources` does, which is what the SDK's
// own `purchase(pay)` relies on), so the group is simulated once with
// unnamed resources allowed and the discovered accounts / apps / assets /
// boxes are attached to the real call.

import algosdk from 'algosdk';

import type { NetworkId } from '../../types/wallet';
import { getAlgodClient } from '../algorand/client';
import { makeParsecSigner } from './signer';

// NFDInstance ABI — `renew(pay)void`.
export const RENEW_METHOD = new algosdk.ABIMethod({
  name: 'renew',
  desc: 'Extend the lease of a V3 NFD; the payment amount sets the period.',
  args: [{ name: 'payment', type: 'pay', desc: 'Renewal payment to the NFD app address.' }],
  returns: { type: 'void' },
});

// NFDInstance ABI — readonly `getRenewPrice()uint64`, microAlgos per year.
export const GET_RENEW_PRICE_METHOD = new algosdk.ABIMethod({
  name: 'getRenewPrice',
  desc: 'Current one-year renewal price for this NFD, in microAlgos.',
  args: [],
  returns: { type: 'uint64' },
});

/** NFD_MAX_EXPIRATION_DAYS ≈ 20 years — the furthest any lease may reach. */
export const MAX_RENEW_YEARS = 20;

/** Flat fee cushion for the app call — renew emits inner txns (registry
 * bookkeeping, commissions). The SDK uses 9 000 for the sibling `purchase`. */
const RENEW_FEE_MICROALGOS = 10_000;

/** Pure payment math: `years` × per-year price. Throws on a bad input. */
export function renewPaymentAmount(pricePerYear: bigint, years: number): bigint {
  if (!Number.isInteger(years) || years < 1 || years > MAX_RENEW_YEARS) {
    throw new Error(`Renewal must be a whole number of years, 1–${MAX_RENEW_YEARS}.`);
  }
  if (pricePerYear <= 0n) throw new Error('Renewal price is unavailable for this name.');
  return pricePerYear * BigInt(years);
}

function simulateRequest(): algosdk.modelsv2.SimulateRequest {
  return new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowEmptySignatures: true,
    allowUnnamedResources: true,
  });
}

/** Per-year renewal price in microAlgos, read via a simulated readonly call. */
export async function getRenewPrice(
  network: NetworkId,
  appId: number | bigint,
  sender: string,
): Promise<bigint> {
  const algod = getAlgodClient(network);
  const sp = await algod.getTransactionParams().do();
  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: Number(appId),
    method: GET_RENEW_PRICE_METHOD,
    methodArgs: [],
    sender,
    signer: algosdk.makeEmptyTransactionSigner(),
    suggestedParams: { ...sp, flatFee: true, fee: 1000 },
  });
  const { methodResults, simulateResponse } = await atc.simulate(algod, simulateRequest());
  const failure = simulateResponse.txnGroups[0]?.failureMessage;
  if (failure) throw new Error(`getRenewPrice failed: ${failure}`);
  const result = methodResults[0];
  if (result?.decodeError) throw result.decodeError;
  if (typeof result?.returnValue !== 'bigint') {
    throw new Error('getRenewPrice returned no value.');
  }
  return result.returnValue;
}

export interface RenewArgs {
  network: NetworkId;
  /** The NFD instance application id (`nfd.appID`). */
  appId: number | bigint;
  /** Current owner — the signing and paying account. */
  owner: string;
  passphrase: string;
  /** Whole years to add, 1–20. */
  years: number;
  /** Per-year price if already fetched; otherwise read on-chain first. */
  pricePerYear?: bigint;
}

export interface RenewResult {
  /** Transaction id of the `renew` app call. */
  txId: string;
  /** Id of the accompanying payment transaction. */
  paymentTxId: string;
  amountMicroAlgos: bigint;
  pricePerYear: bigint;
  years: number;
}

interface ResourceRefs {
  appAccounts?: (string | algosdk.Address)[];
  appForeignApps?: (number | bigint)[];
  appForeignAssets?: (number | bigint)[];
  boxes?: algosdk.BoxReference[];
}

/**
 * Renew a leased NFD the caller owns: payment (price × years) to the app
 * address + `renew(pay)` in one atomic group, signed by the PARSEC keystore.
 */
export async function renewNfd(args: RenewArgs): Promise<RenewResult> {
  const pricePerYear = args.pricePerYear ?? (await getRenewPrice(args.network, args.appId, args.owner));
  const amount = renewPaymentAmount(pricePerYear, args.years);

  const algod = getAlgodClient(args.network);
  const sp = await algod.getTransactionParams().do();
  const appId = Number(args.appId);
  const appAddress = algosdk.getApplicationAddress(appId);

  const compose = (signer: algosdk.TransactionSigner, refs: ResourceRefs) => {
    const payment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: args.owner,
      receiver: appAddress,
      amount,
      suggestedParams: sp,
    });
    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
      appID: appId,
      method: RENEW_METHOD,
      methodArgs: [{ txn: payment, signer }],
      sender: args.owner,
      signer,
      suggestedParams: { ...sp, flatFee: true, fee: RENEW_FEE_MICROALGOS },
      ...refs,
    });
    return atc;
  };

  // Dry run: surfaces a contract rejection before anything is signed, and
  // yields the references the real call must carry.
  const refs = await discoverResources(algod, compose(algosdk.makeEmptyTransactionSigner(), {}));

  const signer = makeParsecSigner(args.owner, args.passphrase);
  const result = await compose(signer, refs).execute(algod, 4);
  return {
    paymentTxId: result.txIDs[0],
    txId: result.txIDs[1],
    amountMicroAlgos: amount,
    pricePerYear,
    years: args.years,
  };
}

async function discoverResources(
  algod: algosdk.Algodv2,
  atc: algosdk.AtomicTransactionComposer,
): Promise<ResourceRefs> {
  const { simulateResponse } = await atc.simulate(algod, simulateRequest());
  const group = simulateResponse.txnGroups[0];
  if (group?.failureMessage) throw new Error(`Renewal rejected: ${group.failureMessage}`);

  const accounts = new Map<string, algosdk.Address>();
  const apps = new Set<bigint>();
  const assets = new Set<bigint>();
  const boxes: algosdk.BoxReference[] = [];
  const pools = [group?.unnamedResourcesAccessed, ...(group?.txnResults ?? []).map((t) => t.unnamedResourcesAccessed)];
  for (const u of pools) {
    if (!u) continue;
    for (const a of u.accounts ?? []) accounts.set(a.toString(), a);
    for (const id of u.apps ?? []) apps.add(id);
    for (const id of u.assets ?? []) assets.add(id);
    for (const l of u.appLocals ?? []) { accounts.set(l.account.toString(), l.account); apps.add(l.app); }
    for (const h of u.assetHoldings ?? []) { accounts.set(h.account.toString(), h.account); assets.add(h.asset); }
    for (const b of u.boxes ?? []) boxes.push({ appIndex: b.app, name: b.name });
  }
  return {
    appAccounts: [...accounts.values()],
    appForeignApps: [...apps],
    appForeignAssets: [...assets],
    boxes,
  };
}
