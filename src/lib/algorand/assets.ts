// Parsec Wallet — ASA Management
// Opt-in, opt-out, lookup, enrichment, known registry.
// 6 decimal precision default for all assets.

import algosdk from 'algosdk';
import type { AssetHolding, NetworkId } from '../../types/wallet';
import { getAlgodClient, getIndexerClient } from './client';

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
}

/** Look up asset info from the network */
export async function lookupAsset(assetId: number, network: NetworkId): Promise<AssetInfo | null> {
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
    };
  } catch {
    return null;
  }
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

/** Enrich asset holdings with metadata */
export async function enrichAssets(assets: AssetHolding[], network: NetworkId): Promise<AssetHolding[]> {
  const enriched: AssetHolding[] = [];

  for (const asset of assets) {
    const known = KNOWN_ASSETS.find(k => k.assetId === asset.assetId && k.network === network);
    if (known) {
      enriched.push({ ...asset, name: known.name, unitName: known.unitName, decimals: known.decimals });
    } else if (!asset.unitName) {
      const info = await lookupAsset(asset.assetId, network);
      enriched.push({
        ...asset,
        name: info?.name,
        unitName: info?.unitName,
        decimals: info?.decimals ?? DEFAULT_DECIMALS,
        hasFreezeAddr: info?.hasFreezeAddr,
        hasClawbackAddr: info?.hasClawbackAddr,
      });
    } else {
      enriched.push({ ...asset, decimals: asset.decimals ?? DEFAULT_DECIMALS });
    }
  }

  return enriched;
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
