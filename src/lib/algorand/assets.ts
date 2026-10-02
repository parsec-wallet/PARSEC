// PARSEC Wallet — ASA Management
// Opt-in, opt-out, lookup, enrichment, known registry.
// 6 decimal precision default for all assets.

import type { WalletSigner } from './signer';
import algosdk from 'algosdk';
import pMap from 'p-map';
import type { AssetHolding, NetworkId } from '../../types/wallet';
import { getAlgodClient, getIndexerClient } from './client';
import { rateLimitedQuery } from './query-cache';
import { resolveNftMetadata } from './nft-metadata';

export const DEFAULT_DECIMALS = 6;

export interface KnownAsset {
  assetId: number;
  name: string;
  unitName: string;
  decimals: number;
  network: NetworkId;
}

// Official contract ASAs only — verified issuers, significant market cap
export const KNOWN_ASSETS: KnownAsset[] = [
  // Mainnet — Circle (USDC official issuer on Algorand)
  { assetId: 31566704, name: 'USD Coin', unitName: 'USDC', decimals: 6, network: 'mainnet' },
  // Mainnet — Tether (USDt official on Algorand)
  { assetId: 312769, name: 'Tether USDt', unitName: 'USDt', decimals: 6, network: 'mainnet' },
  // Testnet — USDC test token
  { assetId: 10458941, name: 'USDC (Testnet)', unitName: 'USDC', decimals: 6, network: 'testnet' },
];

export interface AssetInfo {
  name: string;
  unitName: string;
  decimals: number;
  total: number;
  hasFreezeAddr: boolean;
  hasClawbackAddr: boolean;
  creator: string;
  url?: string;
  reserve?: string;
}

/** Look up asset info from the network. Cached + rate-limited per network. */
export async function lookupAsset(assetId: number, network: NetworkId): Promise<AssetInfo | null> {
  return rateLimitedQuery(`algod:${network}`, `asset:${assetId}@${network}`, 60_000, async () => {
    try {
      const client = getAlgodClient(network);
      const info = await client.getAssetByID(assetId).do();
      const params = info.params;
      return {
        name: String(params?.name || `ASA #${assetId}`),
        unitName: String(params?.unitName || ''),
        decimals: Number(params?.decimals ?? DEFAULT_DECIMALS),
        total: Number(params?.total || 0),
        hasFreezeAddr: isSetAddress(params?.freeze),
        hasClawbackAddr: isSetAddress(params?.clawback),
        creator: String(params?.creator || ''),
        url: params?.url ? String(params.url) : undefined,
        reserve: params?.reserve ? String(params.reserve) : undefined,
      };
    } catch {
      return null;
    }
  });
}

const ZERO_ADDRESS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

/** An issuer role is held only when its address is set and not the zero address. */
function isSetAddress(a: unknown): boolean {
  if (a === undefined || a === null) return false;
  const s = String(a);
  return s !== '' && s !== ZERO_ADDRESS;
}

/** Search for an asset by name or ID */
export async function searchAssets(
  query: string,
  network: NetworkId,
): Promise<{ assetId: number; name: string; unitName: string; decimals: number; hasFreezeAddr: boolean; hasClawbackAddr: boolean }[]> {
  const assetIdNum = parseInt(query, 10);
  if (!isNaN(assetIdNum) && assetIdNum > 0) {
    const info = await lookupAsset(assetIdNum, network);
    if (info) return [{ assetId: assetIdNum, ...info }];
    return [];
  }

  try {
    const indexer = getIndexerClient(network);
    // By name and by unit (ticker), merged: "USDC" is a unit, "USD Coin" a name.
    const [byName, byUnit] = await Promise.all([
      indexer.searchForAssets().name(query).limit(20).do().catch(() => ({ assets: [] })),
      indexer.searchForAssets().unit(query).limit(20).do().catch(() => ({ assets: [] })),
    ]);
    const seen = new Set<string>();
    const merged = [...(byUnit.assets || []), ...(byName.assets || [])].filter((a) => {
      const k = String(a.index);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 24);
    return merged.map((a) => {
      const params = a.params;
      return {
        assetId: Number(a.index),
        name: String(params?.name || ''),
        unitName: String(params?.unitName || ''),
        decimals: Number(params?.decimals ?? DEFAULT_DECIMALS),
        hasFreezeAddr: isSetAddress(params?.freeze),
        hasClawbackAddr: isSetAddress(params?.clawback),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Opt in to an ASA, signed by the PARSEC Keycore: the transaction is built here,
 * its bytes are signed in Rust (`chain_algo_sign_transaction`), and only the
 * signature comes back. No key or phrase enters JavaScript.
 */
export async function optInWithKeycore(address: string, assetId: number, network: NetworkId): Promise<{ txId: string }> {
  const { algoSignTransaction } = await import('../chain-algo');
  const client = getAlgodClient(network);
  const suggestedParams = await client.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address, receiver: address, amount: 0, assetIndex: assetId, suggestedParams,
  });
  const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const { signature_b64 } = await algoSignTransaction(address, toB64(txn.bytesToSign()));
  const signed = txn.attachSignature(address, fromB64(signature_b64));
  const { txid } = await client.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(client, txid, 4);
  return { txId: txid };
}

/** Opt in to an ASA with a mnemonic held in JS — the browser build only, which has no Keycore. */
export async function optInToAsset(mnemonic: string, assetId: number, network: NetworkId): Promise<{ txId: string }> {
  const client = getAlgodClient(network);
  const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
  const suggestedParams = await client.getTransactionParams().do();

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: account.addr,
    amount: 0,
    assetIndex: assetId,
    suggestedParams,
  });

  const signedTxn = txn.signTxn(account.sk);
  const { txid } = await client.sendRawTransaction(signedTxn).do();
  await algosdk.waitForConfirmation(client, txid, 4);
  return { txId: txid };
}

/** Opt out of an ASA — closes asset to creator, recovers 0.1 ALGO min balance */
export async function optOutFromAsset(
  signer: WalletSigner,
  assetId: number,
  creatorAddress: string,
  network: NetworkId,
): Promise<{ txId: string }> {
  // Signed by the PARSEC Keycore (desktop, phone) through `walletSigner`; no phrase in JS.
  const client = getAlgodClient(network);
  const suggestedParams = await client.getTransactionParams().do();

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: signer.address,
    receiver: creatorAddress,
    amount: 0,
    assetIndex: assetId,
    closeRemainderTo: creatorAddress,
    suggestedParams,
  });

  const [signedTxn] = await signer.sign([txn], [0]);
  const { txid } = await client.sendRawTransaction(signedTxn).do();
  await algosdk.waitForConfirmation(client, txid, 4);
  return { txId: txid };
}

/** Enrich asset holdings with metadata + NFT details. Parallelized with bounded concurrency. */
export async function enrichAssets(assets: AssetHolding[], network: NetworkId): Promise<AssetHolding[]> {
  return pMap(assets, async (asset) => {
    const known = KNOWN_ASSETS.find(k => k.assetId === asset.assetId && k.network === network);
    if (known) {
      return { ...asset, name: known.name, unitName: known.unitName, decimals: known.decimals };
    }

    const info = await lookupAsset(asset.assetId, network);
    const base: AssetHolding = {
      ...asset,
      name: info?.name ?? asset.name,
      unitName: info?.unitName ?? asset.unitName,
      decimals: info?.decimals ?? asset.decimals ?? DEFAULT_DECIMALS,
      hasFreezeAddr: info?.hasFreezeAddr ?? asset.hasFreezeAddr,
      hasClawbackAddr: info?.hasClawbackAddr ?? asset.hasClawbackAddr,
    };

    // NFT metadata is opportunistic — failure is non-fatal.
    if (info?.url || info?.name) {
      const nft = await resolveNftMetadata(asset.assetId, {
        url: info.url,
        reserve: info.reserve,
        name: info.name,
        unitName: info.unitName,
      }, network).catch(() => null);
      if (nft) base.nft = nft;
    }

    return base;
  }, { concurrency: 8 });
}

/** Format an asset amount with proper decimals (default 6) */
export function formatAssetAmount(amount: number, decimals?: number): string {
  const d = decimals ?? DEFAULT_DECIMALS;
  if (d === 0) return String(amount);
  return (amount / Math.pow(10, d)).toFixed(Math.min(d, DEFAULT_DECIMALS));
}

export function getKnownAssets(network: NetworkId): KnownAsset[] {
  return KNOWN_ASSETS.filter(a => a.network === network);
}
