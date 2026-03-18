// Parsec Wallet — SpinTrade Swap Engine
// SpinTrade is Parsec's native swap interface.
// NOT a Tinyman fork — uses Tinyman v2 public API for pool quotes and
// executes swaps through Tinyman's on-chain AMM contracts as a participant.
// Future: participant choice of DEX (Tinyman, Pact, Folks, etc).

import algosdk from 'algosdk';
import type { NetworkId } from '../../types/wallet';
import { getAlgodClient } from './client';

// Tinyman v2 AMM app IDs
const TINYMAN_APP_ID: Record<NetworkId, number> = {
  mainnet: 1002541853,
  testnet: 148607000,
  betanet: 0,
};

const ALGO_ASSET_ID = 0; // Native ALGO represented as 0

export interface SwapQuote {
  inputAssetId: number;
  outputAssetId: number;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  exchangeRate: number;
  fee: number; // pool fee in output units
  minOutput: number; // after slippage
  poolAddress: string;
}

export interface SwapableAsset {
  assetId: number;
  unitName: string;
  name: string;
  decimals: number;
}

/** Fetch top tradeable assets from Tinyman pools — zero cost, public API */
export async function fetchTradeableAssets(
  network: NetworkId,
  limit = 30,
): Promise<SwapableAsset[]> {
  const subdomain = network === 'mainnet' ? 'mainnet' : 'testnet';
  try {
    const response = await fetch(
      `https://${subdomain}.analytics.tinyman.org/api/v1/assets/?ordering=-liquidity_in_usd&limit=${limit}&with_liquidity=true`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (data.results || []).map((a: Record<string, unknown>) => ({
      assetId: Number(a.id),
      unitName: String(a.unit_name || ''),
      name: String(a.name || ''),
      decimals: Number(a.decimals ?? 6),
      verified: Boolean(a.is_verified),
      liquidity: Number(a.liquidity_in_usd || 0),
    }));
  } catch {
    return [];
  }
}

/** Fetch pools available for a specific input asset */
export async function fetchPoolsForAsset(
  assetId: number,
  network: NetworkId,
): Promise<SwapableAsset[]> {
  const subdomain = network === 'mainnet' ? 'mainnet' : 'testnet';
  const queryId = assetId === 0 ? 0 : assetId;
  try {
    const response = await fetch(
      `https://${subdomain}.analytics.tinyman.org/api/v1/pools/?asset_1=${queryId}&with_liquidity=true&ordering=-liquidity_in_usd&limit=20`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) return [];
    const data = await response.json();
    const assets: SwapableAsset[] = [];
    for (const pool of data.results || []) {
      // Return the OTHER asset in the pair
      const other = pool.asset_1?.id === queryId ? pool.asset_2 : pool.asset_1;
      if (other && !assets.some(a => a.assetId === Number(other.id))) {
        assets.push({
          assetId: Number(other.id),
          unitName: String(other.unit_name || ''),
          name: String(other.name || ''),
          decimals: Number(other.decimals ?? 6),
        });
      }
    }
    return assets;
  } catch {
    return [];
  }
}

/** Fetch a swap quote from Tinyman v2 pools */
export async function getSwapQuote(
  inputAssetId: number,
  outputAssetId: number,
  inputAmount: number,
  slippageBps: number, // basis points, e.g. 50 = 0.5%
  network: NetworkId,
): Promise<SwapQuote | null> {
  const appId = TINYMAN_APP_ID[network];
  if (!appId) return null;

  try {
    // Look up pool via the AMM application
    // Tinyman v2 pool discovery: the pool is a logicsig account
    // For MVP: use the Tinyman API for quote (future: direct contract reads)
    const response = await fetch(
      `https://mainnet.analytics.tinyman.org/api/v1/pools/?asset_1=${inputAssetId}&asset_2=${outputAssetId}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) return null;
    const data = await response.json();
    const pool = data.results?.[0];
    if (!pool) return null;

    // Calculate quote from pool reserves
    const isAsset1Input = pool.asset_1.id === inputAssetId;
    const inputReserve = isAsset1Input
      ? Number(pool.current_asset_1_reserves)
      : Number(pool.current_asset_2_reserves);
    const outputReserve = isAsset1Input
      ? Number(pool.current_asset_2_reserves)
      : Number(pool.current_asset_1_reserves);

    if (inputReserve === 0 || outputReserve === 0) return null;

    // Constant product formula with 0.3% fee
    const feeRate = 0.003;
    const inputAfterFee = inputAmount * (1 - feeRate);
    const outputAmount = Math.floor(
      (outputReserve * inputAfterFee) / (inputReserve + inputAfterFee)
    );
    const fee = Math.floor(inputAmount * feeRate);
    const priceImpact = (inputAmount / inputReserve) * 100;
    const exchangeRate = outputAmount / inputAmount;
    const minOutput = Math.floor(outputAmount * (1 - slippageBps / 10000));

    return {
      inputAssetId,
      outputAssetId,
      inputAmount,
      outputAmount,
      priceImpact,
      exchangeRate,
      fee,
      minOutput,
      poolAddress: pool.address || '',
    };
  } catch {
    return null;
  }
}

/** Execute a swap via Tinyman v2 — fixed input mode */
export async function executeSwap(
  mnemonic: string,
  inputAssetId: number,
  outputAssetId: number,
  inputAmount: number,
  minOutputAmount: number,
  poolAddress: string,
  network: NetworkId,
): Promise<{ txId: string }> {
  const client = getAlgodClient(network);
  const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
  const appId = TINYMAN_APP_ID[network];
  const suggestedParams = await client.getTransactionParams().do();

  // Group transaction: 1) transfer input to pool, 2) app call to swap
  const txns: algosdk.Transaction[] = [];

  // Transaction 1: Transfer input asset to pool
  if (inputAssetId === ALGO_ASSET_ID) {
    txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver: poolAddress,
      amount: inputAmount,
      suggestedParams,
    }));
  } else {
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver: poolAddress,
      amount: inputAmount,
      assetIndex: inputAssetId,
      suggestedParams,
    }));
  }

  // Transaction 2: App call to execute swap
  const swapParams = { ...suggestedParams, fee: 8000 }; // 8x min fee for inner txns
  txns.push(algosdk.makeApplicationCallTxnFromObject({
    sender: account.addr,
    appIndex: appId,
    appArgs: [
      new TextEncoder().encode('swap'),
      new TextEncoder().encode('fixed-input'),
      algosdk.encodeUint64(minOutputAmount),
    ],
    foreignAssets: [
      ...(inputAssetId !== ALGO_ASSET_ID ? [inputAssetId] : []),
      ...(outputAssetId !== ALGO_ASSET_ID ? [outputAssetId] : []),
    ],
    accounts: [poolAddress],
    suggestedParams: swapParams,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
  }));

  // Assign group ID
  algosdk.assignGroupID(txns);

  // Sign all transactions
  const signedTxns = txns.map(txn => txn.signTxn(account.sk));

  // Submit group
  const { txid } = await client.sendRawTransaction(signedTxns).do();
  await algosdk.waitForConfirmation(client, txid, 6);

  return { txId: txid };
}
