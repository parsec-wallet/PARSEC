// Subdomain (NFD "segment") support.
//
// A segment is a child name under a root NFD — `shop.yourname.algo` under
// `yourname.algo`. Minting a segment uses the ordinary mint flow
// (`mintNfdWithFee` accepts a segment name directly), but segment minting is
// LOCKED by default on every root NFD. The root owner must unlock it.
//
// The NFD SDK exposes the segment *validators* but no unlock method, so the
// unlock is a hand-rolled ABI call against the NFD instance contract —
// mirroring the `offerForSale` call in `./transfer.ts`.

import algosdk from 'algosdk';
import { isSegmentMintingUnlocked } from '@txnlab/nfd-sdk';

import type { NetworkId } from '../../types/wallet';
import { getAlgodClient } from '../algorand/client';
import { makeParsecSigner } from './signer';

// `isSegmentMintingUnlocked` is the one segment helper not already surfaced
// by validate.ts — re-export it so the nfd barrel carries the full set.
export { isSegmentMintingUnlocked };

// NFDInstance ABI — `segmentLock(bool,uint64)void`. lock=false opens
// subdomain minting to the public at `usdPrice` per segment.
export const SEGMENT_LOCK_METHOD = new algosdk.ABIMethod({
  name: 'segmentLock',
  desc: 'Lock or unlock public subdomain (segment) minting under this NFD.',
  args: [
    { name: 'lock', type: 'bool' },
    { name: 'usdPrice', type: 'uint64' },
  ],
  returns: { type: 'void' },
});

/** USD → the uint64 unit NFD's contract expects (micro-USD, 1e6). */
export const USD_TO_SEGMENT_PRICE = 1_000_000n;

export interface SegmentLockArgs {
  network: NetworkId;
  /** The root NFD instance application id (`nfd.appID`). */
  nfdAppId: number | bigint;
  /** Root owner — the signing account. */
  owner: string;
  passphrase: string;
  /** false opens subdomains to the public; true re-locks them. */
  lock: boolean;
  /**
   * Per-subdomain price in micro-USD (USD × 1e6). 0n = free subdomains.
   * NOTE: the exact uint64 unit is an NFD-contract convention — verify with
   * a small value on the first live call.
   */
  usdPriceMicros?: bigint;
}

/**
 * Open (or re-lock) public subdomain minting under a root NFD the caller
 * owns. Returns the transaction id. Once open, anyone can mint a segment
 * (`label.<root>.algo`) through the ordinary mint flow.
 */
export async function setSegmentLock(args: SegmentLockArgs): Promise<string> {
  const algod = getAlgodClient(args.network);
  const sp = await algod.getTransactionParams().do();
  const signer = makeParsecSigner(args.owner, args.passphrase);

  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: Number(args.nfdAppId),
    method: SEGMENT_LOCK_METHOD,
    methodArgs: [args.lock, args.usdPriceMicros ?? 0n],
    sender: args.owner,
    signer,
    // Flat fee with a cushion in case the contract emits an inner txn.
    suggestedParams: { ...sp, flatFee: true, fee: 2000 },
  });

  const result = await atc.execute(algod, 4);
  return result.txIDs[0];
}
