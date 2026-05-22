// Transfer an owned .algo name to another wallet.
//
// NFD has no unilateral "transfer" — ownership moves through a reserve-then-
// claim handshake. The current owner calls the NFD instance contract's
// `offerForSale(sellAmount, reservedFor)` ABI method, reserving the name for
// one specific recipient (at any price, or 0 to gift it). The recipient then
// claims/buys it from their own wallet — Parsec's marketplace buy flow
// handles that side.
//
// The NFD SDK exposes the recipient side (`buy` / `claim`) but not the
// owner-side offer, so this hand-rolls the single ABI call against the
// instance app.

import algosdk from 'algosdk';

import type { NetworkId } from '../../types/wallet';
import { getAlgodClient } from '../algorand/client';
import { makeParsecSigner } from './signer';

// NFDInstance ABI — `offerForSale(uint64,address)void`. Reserving for a
// specific address turns the offer into a directed transfer.
const OFFER_FOR_SALE = new algosdk.ABIMethod({
  name: 'offerForSale',
  desc: 'Offer this NFD for sale, optionally reserved for one buyer.',
  args: [
    { name: 'sellAmount', type: 'uint64' },
    { name: 'reservedFor', type: 'address' },
  ],
  returns: { type: 'void' },
});

export interface NfdTransferArgs {
  network: NetworkId;
  /** The NFD instance application id (from `nfd.appID`). */
  nfdAppId: number | bigint;
  /** Current owner — the signing account. */
  owner: string;
  passphrase: string;
  /** Wallet the name is being transferred to. */
  recipient: string;
  /** Price the recipient pays, in microAlgos. 0n = gift. Defaults to 0n. */
  priceMicroAlgos?: bigint;
}

/**
 * Reserve an owned NFD for `recipient`. Returns the transaction id of the
 * on-chain offer. The recipient must then claim/buy it to complete the
 * transfer — until they do, the name still belongs to the sender, who can
 * cancel the offer.
 */
export async function offerNfdForTransfer(args: NfdTransferArgs): Promise<string> {
  if (!algosdk.isValidAddress(args.recipient)) {
    throw new Error('Recipient is not a valid Algorand address.');
  }
  if (args.recipient === args.owner) {
    throw new Error('Recipient must be a different wallet than the current owner.');
  }

  const algod = getAlgodClient(args.network);
  const sp = await algod.getTransactionParams().do();
  const signer = makeParsecSigner(args.owner, args.passphrase);

  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: Number(args.nfdAppId),
    method: OFFER_FOR_SALE,
    methodArgs: [args.priceMicroAlgos ?? 0n, args.recipient],
    sender: args.owner,
    signer,
    // Flat fee with a small cushion in case the contract emits an inner txn.
    suggestedParams: { ...sp, flatFee: true, fee: 2000 },
  });

  const result = await atc.execute(algod, 4);
  return result.txIDs[0];
}
