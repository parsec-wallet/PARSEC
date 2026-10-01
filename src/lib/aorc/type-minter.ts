// aORC TypeMinter client (app 757891101 on testnet).
//
// TypeMinter accepts a single ABI method per token type:
//   * mint_aNFT(name, unit_name, url) → uint64
//   * mint_dNFT(name, unit_name, url, controller) → uint64
//   * mint_iNFT(name, unit_name, url, model_id) → uint64
//   * mint_THOT(name, unit_name, url, cid)      → uint64   (CID uniqueness enforced)
//
// The on-chain logic creates the ASA via inner txn and (for THOT) writes
// the CID to a box keyed by `thot:<cid>`. We don't have the contract source
// in this repo (see plan), so the signatures here are taken from the
// observed testnet behaviour + the TODO-INDEX 2026-03-28 session notes.
//
// If TypeMinter isn't configured for the active network (mainnet placeholder),
// callers should fall back to the generic minter in ./minter.ts.

import algosdk from 'algosdk';
import { getAlgodClient } from '../algorand/client';
import { buildAlgorandX402Signer } from '../x402/bridge';
import type { NetworkId } from '../../types/wallet';
import { getAorcIds, isAorcConfigured } from './ids';
import type { AorcMintMeta, AorcMintResult, AorcTokenType } from './types';

/** Build the application-call transaction for a TypeMinter mint. */
export async function buildTypeMintTxn(opts: {
  creator: string;
  type: AorcTokenType;
  meta: AorcMintMeta;
  /** dNFT only: controller address. */
  controller?: string;
  /** iNFT only: model id (uint64). */
  modelId?: number;
  /** THOT only: IPFS CID (must be unique on the Registry). */
  cid?: string;
  network: NetworkId;
}): Promise<algosdk.Transaction> {
  if (!isAorcConfigured(opts.network)) {
    throw new Error(`TypeMinter not configured for ${opts.network}; use the generic minter.`);
  }
  const client = getAlgodClient(opts.network);
  const suggestedParams = await client.getTransactionParams().do();
  const ids = getAorcIds(opts.network);

  const method = pickMethod(opts.type);
  const args: Uint8Array[] = [
    method,                                                                          // method selector
    new TextEncoder().encode(opts.meta.name),
    new TextEncoder().encode(opts.meta.unitName),
    new TextEncoder().encode(opts.meta.url ?? ''),
  ];
  if (opts.type === 'dNFT') {
    if (!opts.controller) throw new Error('dNFT requires controller');
    args.push(algosdk.decodeAddress(opts.controller).publicKey);
  }
  if (opts.type === 'iNFT') {
    if (opts.modelId === undefined) throw new Error('iNFT requires modelId');
    args.push(encodeUint64(opts.modelId));
  }
  if (opts.type === 'THOT') {
    if (!opts.cid) throw new Error('THOT requires CID');
    args.push(new TextEncoder().encode(opts.cid));
  }

  return algosdk.makeApplicationNoOpTxnFromObject({
    sender: opts.creator,
    suggestedParams,
    appIndex: ids.typeMinter,
    appArgs: args,
    // The TypeMinter creates the ASA via inner txn; we must declare the
    // expected inner asset so the simulator/validator covers the indices.
    // Box references encode CID uniqueness for THOT.
    boxes: opts.type === 'THOT' && opts.cid
      ? [{ appIndex: ids.registry, name: new TextEncoder().encode(`thot:${opts.cid}`) }]
      : undefined,
    foreignApps: opts.type === 'THOT' ? [ids.registry] : undefined,
  });
}

export async function signAndSendTypeMint(opts: {
  creator: string;
  passphrase: string;
  type: AorcTokenType;
  meta: AorcMintMeta;
  controller?: string;
  modelId?: number;
  cid?: string;
  network: NetworkId;
}): Promise<AorcMintResult> {
  const txn = await buildTypeMintTxn(opts);
  const signer = await buildAlgorandX402Signer(opts.creator, opts.passphrase, opts.network);
  const encoded = algosdk.encodeUnsignedTransaction(txn);
  const signed = await signer.signTransaction(encoded);
  const txid = await signer.sendTransactions([signed]);
  const confirmation = await signer.waitForConfirmation(txid, opts.network, 6);

  // TypeMinter returns the new asset id as an inner-txn createdAssetIndex
  // OR as a logged ABI return. We try createdAssetIndex first.
  const inner = (confirmation as { innerTxns?: { assetIndex?: number | bigint; createdAssetIndex?: number | bigint }[] }).innerTxns;
  const innerAsset = inner?.find((t) => t.assetIndex || t.createdAssetIndex);
  const assetId = Number(innerAsset?.createdAssetIndex ?? innerAsset?.assetIndex ?? 0);
  if (!assetId) {
    throw new Error(`TypeMinter call confirmed but no inner asset id surfaced (txid=${txid}).`);
  }
  return {
    assetId,
    txId: txid,
    confirmedRound: Number((confirmation as { confirmedRound?: number | bigint }).confirmedRound ?? 0),
  };
}

/** Check whether a CID is already minted as a THOT. */
export async function isCidMinted(cid: string, network: NetworkId): Promise<boolean> {
  if (!isAorcConfigured(network)) return false;
  const client = getAlgodClient(network);
  const ids = getAorcIds(network);
  try {
    await client.getApplicationBoxByName(ids.registry, new TextEncoder().encode(`thot:${cid}`)).do();
    return true;
  } catch {
    return false;
  }
}

function pickMethod(type: AorcTokenType): Uint8Array {
  // ABI selectors: first 4 bytes of sha512/256(method-signature).
  // These signatures match the testnet TypeMinter; if the contract is
  // reissued with different signatures, regenerate via algosdk's ABI helpers.
  const sig: Record<AorcTokenType, string> = {
    aNFT: 'mint_aNFT(string,string,string)uint64',
    dNFT: 'mint_dNFT(string,string,string,address)uint64',
    iNFT: 'mint_iNFT(string,string,string,uint64)uint64',
    THOT: 'mint_THOT(string,string,string,string)uint64',
  };
  return algosdk.ABIMethod.fromSignature(sig[type]).getSelector();
}

function encodeUint64(n: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(n), false);
  return buf;
}
