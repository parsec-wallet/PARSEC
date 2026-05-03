// Parsec Wallet — ASA Management
// Opt-in, opt-out, lookup, enrichment, known registry.
// 6 decimal precision default for all assets.

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
        hasFreezeAddr: !!params?.freeze,
        hasClawbackAddr: !!params?.clawback,
        creator: String(params?.creator || ''),
        url: params?.url ? String(params.url) : undefined,
        reserve: params?.reserve ? String(params.reserve) : undefined,
      };
    } catch {
      return null;
    }
  });
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
    const response = await indexer.searchForAssets().name(query).limit(10).do();
    return (response.assets || []).map((a) => {
      const params = a.params;
      return {
        assetId: Number(a.index),
        name: String(params?.name || ''),
        unitName: String(params?.unitName || ''),
        decimals: Number(params?.decimals ?? DEFAULT_DECIMALS),
        hasFreezeAddr: !!params?.freeze,
        hasClawbackAddr: !!params?.clawback,
      };
    });
  } catch {
    return [];
  }
}

/** Opt in to an ASA */
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
  mnemonic: string,
  assetId: number,
  creatorAddress: string,
  network: NetworkId,
): Promise<{ txId: string }> {
  const client = getAlgodClient(network);
  const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
  const suggestedParams = await client.getTransactionParams().do();

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: creatorAddress,
    amount: 0,
    assetIndex: assetId,
    closeRemainderTo: creatorAddress,
    suggestedParams,
  });

  const signedTxn = txn.signTxn(account.sk);
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
