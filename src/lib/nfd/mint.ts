// Mint flow with the BANKONx402 fee layer.
//
// The NFD Registry bakes its treasury + commission addresses into the TEAL
// template at compile time — we can't slot BANKON into that split. The
// BANKONx402 fee is therefore a separate payment transaction the user signs
// either (a) atomically before the SDK's mint group or (b) as a preceding
// standalone group if atomic composition turns out to be impractical.
//
// This first pass uses strategy (b): a standalone BANKONx402 fee payment,
// then the SDK's mint(). Two signatures for the user, but the UI is
// explicit about exactly what each one is doing. A future revision will
// compose them into a single atomic group once we can safely extend the
// SDK's internal AlgoKit composer.

import algosdk from 'algosdk';

import type { NetworkId } from '../../types/wallet';
import { getAlgodClient } from '../algorand/client';
import { getNfdClient } from './client';
import { lookupNfd, invalidateNfdCaches } from './resolve';
import { bankonFeeFor, getBankonFeeAddress, isFeeConfigured } from './fees';
import { makeParsecSigner } from './signer';
import type {
  MintProgress,
  Nfd,
  NfdMintCostBreakdown,
  NfdMintQuote,
} from './types';

export interface QuoteArgs {
  network: NetworkId;
  name: string;
  buyer: string;
  years: number;
}

/** Fetch an NFD mint quote + layer BANKONx402's fee on top. */
export async function getMintQuoteWithBankonFee(
  args: QuoteArgs,
): Promise<NfdMintCostBreakdown & { raw: NfdMintQuote }> {
  const client = getNfdClient(args.network);
  const raw = await client.getMintQuote(args.name, {
    buyer: args.buyer,
    years: args.years,
  });
  const bankonFee = bankonFeeFor(raw, args.buyer);
  return {
    nfdName: raw.nfdName,
    years: raw.years,
    isSegment: raw.isSegment,
    basePrice: raw.basePrice,
    carryCost: raw.carryCost,
    extraFee: raw.extraFee,
    bankonFee,
    totalMicroAlgos: raw.basePrice + raw.carryCost + raw.extraFee + bankonFee,
    raw,
  };
}

export interface MintArgs {
  network: NetworkId;
  name: string;
  buyer: string;
  years: number;
  passphrase: string;
  /** Optional: buy on behalf of someone else. */
  reservedFor?: string;
  /** Progress callback so the UI can animate stages. */
  onProgress?: (progress: MintProgress) => void;
}

/**
 * Full mint flow: (optional) BANKONx402 fee payment, then SDK mint, then resolve.
 * Emits progress via onProgress at each stage; throws on failure.
 */
export async function mintNfdWithFee(args: MintArgs): Promise<Nfd> {
  const progress = (p: MintProgress) => args.onProgress?.(p);

  // Pre-flight existence check. A name registered in ANY state cannot be
  // minted — the NFD Registry rejects it on-chain with an opaque assert
  // ("assert failed pc=..."). Catch it here with a message that says why.
  progress({ stage: 'checking-availability' });
  const existing = await lookupNfd(args.network, args.name);
  if (existing) {
    const owner = existing.owner ? ` It is owned by ${existing.owner}.` : '';
    throw new Error(
      `${args.name} is already registered (${existing.state ?? 'taken'}) and cannot be minted.${owner}`,
    );
  }

  progress({ stage: 'quoting' });
  const quote = await getMintQuoteWithBankonFee({
    network: args.network,
    name: args.name,
    buyer: args.buyer,
    years: args.years,
  });

  const signer = makeParsecSigner(args.buyer, args.passphrase);

  // Mint FIRST. The NFD SDK simulates the mint group before submitting, so a
  // registry rejection surfaces here — before any BANKONx402 fee is charged.
  progress({ stage: 'awaiting-signature' });
  const client = getNfdClient(args.network).setSigner(args.buyer, signer);

  progress({ stage: 'submitting' });
  const nfd = await client.mint(args.name, {
    buyer: args.buyer,
    years: args.years,
    reservedFor: args.reservedFor,
  });

  // The name is minted — only now collect BANKONx402's fee. A failure here does
  // not undo the mint, so it is logged but is not fatal to the flow.
  if (quote.bankonFee > 0n && isFeeConfigured()) {
    progress({ stage: 'paying-bankon-fee' });
    try {
      await payBankonFee(args.network, args.buyer, quote.bankonFee, signer);
    } catch (e) {
      console.warn('NFD minted, but the BANKONx402 fee payment failed:', e);
    }
  }

  // The name now exists — drop cached lookups so a re-check reflects that.
  invalidateNfdCaches();

  progress({
    stage: 'confirmed',
    appId: nfd.appID ? BigInt(nfd.appID) : undefined,
  });
  return nfd;
}

async function payBankonFee(
  network: NetworkId,
  buyer: string,
  amount: bigint,
  signer: algosdk.TransactionSigner,
): Promise<string> {
  const algod = getAlgodClient(network);
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: buyer,
    receiver: getBankonFeeAddress(),
    amount,
    suggestedParams: sp,
    note: new TextEncoder().encode('parsec:nfdominter:bankon-fee'),
  });
  const signed = (await signer([txn], [0]))[0];
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  return txid;
}
