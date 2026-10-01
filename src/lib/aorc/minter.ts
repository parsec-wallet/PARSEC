// Generic NFT minter — works without any aORC application call.
// Builds a standard Algorand asset-create transaction (ARC-3 / ARC-19 /
// ARC-69) and submits it. This is the fallback when the user doesn't
// need type-aware minting (THOT / iNFT etc.).
//
// We keep this in lib/aorc/ so a future enhancement can route through the
// aORC Minter app (757891101) when the user wants on-chain enforcement of
// standard fields. For now an algosdk asset-create is the cleanest, most
// portable mint and works the same way every Algorand wallet does it.

import algosdk from 'algosdk';
import { getAlgodClient } from '../algorand/client';
import { buildAlgorandX402Signer } from '../x402/bridge';
import type { NetworkId } from '../../types/wallet';
import type { AorcMintMeta, AorcMintResult, AorcNftStandard } from './types';

/** Build the asset-create transaction; caller signs + sends. */
export async function buildMintTxn(opts: {
  creator: string;
  standard: AorcNftStandard;
  meta: AorcMintMeta;
  network: NetworkId;
}): Promise<algosdk.Transaction> {
  const client = getAlgodClient(opts.network);
  const suggestedParams = await client.getTransactionParams().do();

  // ARC-69 carries the metadata in the note field as a JSON blob.
  let note: Uint8Array | undefined;
  if (opts.standard === 'arc-69') {
    note = new TextEncoder().encode(JSON.stringify({
      standard: 'arc69',
      description: opts.meta.name,
      properties: Object.fromEntries((opts.meta.traits ?? []).map((t) => [t.key, t.value])),
    }));
  }

  return algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender: opts.creator,
    suggestedParams,
    total: opts.meta.total,
    decimals: opts.meta.decimals,
    assetName: opts.meta.name,
    unitName: opts.meta.unitName,
    assetURL: opts.meta.url,
    assetMetadataHash: opts.meta.metadataHash
      ? new Uint8Array(Buffer.from(opts.meta.metadataHash, 'base64'))
      : undefined,
    defaultFrozen: false,
    manager: opts.standard === 'arc-19' || opts.standard === 'arc-69' ? opts.creator : undefined,
    reserve: opts.creator,
    freeze: undefined,
    clawback: undefined,
    note,
  });
}

export async function signAndSendMint(opts: {
  creator: string;
  passphrase: string;
  standard: AorcNftStandard;
  meta: AorcMintMeta;
  network: NetworkId;
}): Promise<AorcMintResult> {
  const txn = await buildMintTxn(opts);
  const signer = await buildAlgorandX402Signer(opts.creator, opts.passphrase, opts.network);
  const encoded = algosdk.encodeUnsignedTransaction(txn);
  const signed = await signer.signTransaction(encoded);
  const txid = await signer.sendTransactions([signed]);
  const confirmation = await signer.waitForConfirmation(txid, opts.network, 6);
  const assetId = Number((confirmation as { assetIndex?: number | bigint }).assetIndex ?? 0);
  if (!assetId) {
    throw new Error(`Asset creation confirmed but no assetIndex returned (txid=${txid}).`);
  }
  return {
    assetId,
    txId: txid,
    confirmedRound: Number((confirmation as { confirmedRound?: number | bigint }).confirmedRound ?? 0),
  };
}
