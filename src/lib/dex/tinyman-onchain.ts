// SpinTrade — Tinyman On-Chain Module
// ALL data read directly from Algorand blockchain via Algod + Indexer.
// Zero third-party API dependencies. Sovereign data source.
// Pool discovery via Indexer. Reserves from account state. Execution via AMM contracts.

import algosdk from 'algosdk';
import type { NetworkId } from '../../types/wallet';
import type { DexModule, DexQuote, DexAsset } from './types';
import { getAlgodClient, getIndexerClient } from '../algorand/client';

const TINYMAN_APP_ID: Record<NetworkId, number> = {
  mainnet: 1002541853,
  testnet: 148607000,
  betanet: 0,
};

/** Known high-liquidity pairs — hardcoded from on-chain verified data */
function getKnownPairs(assetId: number, network: NetworkId): DexAsset[] {
  if (network === 'testnet') {
    return assetId === 0
      ? [{ assetId: 10458941, unitName: 'USDC', name: 'USDC (Testnet)', decimals: 6 }]
      : [{ assetId: 0, unitName: 'ALGO', name: 'Algorand', decimals: 6 }];
  }
  const known: DexAsset[] = [
    { assetId: 0, unitName: 'ALGO', name: 'Algorand', decimals: 6 },
    { assetId: 31566704, unitName: 'USDC', name: 'USD Coin', decimals: 6 },
    { assetId: 312769, unitName: 'USDt', name: 'Tether USDt', decimals: 6 },
  ];
  return known.filter(a => a.assetId !== assetId);
}

/** Read pool reserves by finding the pool account on-chain */
async function findPoolAndReserves(
  inputAssetId: number,
  outputAssetId: number,
  network: NetworkId,
): Promise<{ address: string; inputReserve: number; outputReserve: number } | null> {
  const appId = TINYMAN_APP_ID[network];
  if (!appId) return null;

  const indexer = getIndexerClient(network);
  const algod = getAlgodClient(network);

  // Normalize: lower ID = asset1
  const [a1, a2] = inputAssetId < outputAssetId
    ? [inputAssetId, outputAssetId]
    : [outputAssetId, inputAssetId];

  try {
    // Find pool account: search for axfer transactions to the AMM involving our assets
    const searchAsset = a2 > 0 ? a2 : a1; // search for the non-ALGO asset
    const txResponse = await indexer
      .searchForTransactions()
      .applicationID(appId)
      .txType('axfer')
      .assetID(searchAsset > 0 ? searchAsset : undefined as unknown as number)
      .limit(15)
      .do();

    // Candidate pool addresses from transaction receivers
    const candidates = new Set<string>();
    for (const tx of txResponse.transactions || []) {
      const axfer = tx.assetTransferTransaction as Record<string, unknown> | undefined;
      const receiver = String(axfer?.receiver || '');
      if (receiver && receiver !== String(tx.sender || '')) {
        candidates.add(receiver);
      }
    }

    // Check each candidate — is it a pool for our pair?
    for (const addr of candidates) {
      try {
        const acctInfo = await algod.accountInformation(addr).do();
        const appsLocal = (acctInfo as unknown as { appsLocalState?: { id: unknown }[] }).appsLocalState || [];
        const isPool = appsLocal.some(app => Number(app.id) === appId);
        if (!isPool) continue;

        // Check it holds both assets
        const algoBalance = Number(acctInfo.amount || 0);
        const holdings = acctInfo.assets || [];

        let has1 = a1 === 0 ? algoBalance > 0 : false;
        let has2 = false;
        let reserve1 = a1 === 0 ? algoBalance : 0;
        let reserve2 = 0;

        for (const h of holdings) {
          const hId = Number(h.assetId);
          if (hId === a1 && a1 > 0) { has1 = true; reserve1 = Number(h.amount); }
          if (hId === a2) { has2 = true; reserve2 = Number(h.amount); }
        }

        if (has1 && has2 && reserve1 > 0 && reserve2 > 0) {
          // Map reserves back to input/output order
          const inputIsA1 = inputAssetId === a1 || (inputAssetId === 0 && a1 === 0);
          return {
            address: addr,
            inputReserve: inputIsA1 ? reserve1 : reserve2,
            outputReserve: inputIsA1 ? reserve2 : reserve1,
          };
        }
      } catch { continue; }
    }
  } catch { /* indexer search failed */ }

  return null;
}

export const tinymanOnchainModule: DexModule = {
  id: 'tinyman-onchain',
  name: 'Tinyman v2 (on-chain)',
  enabled: true,

  async fetchPairsForAsset(assetId: number, network: NetworkId): Promise<DexAsset[]> {
    const appId = TINYMAN_APP_ID[network];
    if (!appId) return getKnownPairs(assetId, network);

    const indexer = getIndexerClient(network);
    const algod = getAlgodClient(network);
    const discovered: DexAsset[] = [];
    const seenIds = new Set<number>();

    try {
      // Search recent AMM transactions to discover asset pairs
      const response = await indexer
        .searchForTransactions()
        .applicationID(appId)
        .limit(40)
        .do();

      for (const tx of response.transactions || []) {
        const raw = tx as unknown as Record<string, unknown>;
        const innerTxns = (raw.innerTxns || raw['inner-txns'] || []) as Record<string, unknown>[];
        for (const inner of innerTxns) {
          const axfer = (inner.assetTransferTransaction || inner['asset-transfer-transaction']) as Record<string, unknown> | undefined;
          if (axfer) {
            const aid = Number(axfer.assetId || axfer['asset-id'] || 0);
            if (aid > 0 && aid !== assetId && !seenIds.has(aid)) {
              seenIds.add(aid);
            }
          }
        }
      }
    } catch { /* fall through to known pairs */ }

    // Always include known pairs as fallback
    for (const known of getKnownPairs(assetId, network)) {
      if (!seenIds.has(known.assetId)) {
        seenIds.add(known.assetId);
        discovered.push(known);
      }
    }

    // Look up metadata for discovered assets
    for (const aid of seenIds) {
      if (discovered.some(a => a.assetId === aid)) continue;
      try {
        const info = await algod.getAssetByID(aid).do();
        discovered.push({
          assetId: aid,
          unitName: String(info.params?.unitName || ''),
          name: String(info.params?.name || `ASA #${aid}`),
          decimals: Number(info.params?.decimals ?? 6),
        });
      } catch {
        discovered.push({ assetId: aid, unitName: `ASA#${aid}`, name: `ASA #${aid}`, decimals: 6 });
      }
    }

    // Enrich each pair with pool reserves and price from on-chain data
    for (const asset of discovered) {
      try {
        const pool = await findPoolAndReserves(assetId, asset.assetId, network);
        if (pool && pool.inputReserve > 0 && pool.outputReserve > 0) {
          // Input decimals (the asset we're swapping FROM)
          const inputDec = assetId === 0 ? 6 : 6; // ALGO = 6, default 6
          const outputDec = asset.decimals;

          // Reserves in human-readable form
          const inputReserveHuman = pool.inputReserve / Math.pow(10, inputDec);
          const outputReserveHuman = pool.outputReserve / Math.pow(10, outputDec);

          // Price: how much output per 1 input (constant product)
          const price = outputReserveHuman / inputReserveHuman;

          asset.poolReserveThis = pool.outputReserve;
          asset.poolReserveOther = pool.inputReserve;
          asset.poolPrice = price;
          asset.poolLiquidity = `${inputReserveHuman.toFixed(2)} / ${outputReserveHuman.toFixed(2)}`;
        }
      } catch { /* pool lookup failed — show without liquidity data */ }
    }

    return discovered;
  },

  async getQuote(inputAssetId, outputAssetId, inputAmount, slippageBps, network): Promise<DexQuote | null> {
    const pool = await findPoolAndReserves(inputAssetId, outputAssetId, network);
    if (!pool || pool.inputReserve === 0 || pool.outputReserve === 0) return null;

    const feeRate = 0.003;
    const inputAfterFee = inputAmount * (1 - feeRate);
    const outputAmount = Math.floor(
      (pool.outputReserve * inputAfterFee) / (pool.inputReserve + inputAfterFee)
    );
    const minOutput = Math.floor(outputAmount * (1 - slippageBps / 10000));

    return {
      inputAssetId, outputAssetId, inputAmount, outputAmount,
      priceImpact: (inputAmount / pool.inputReserve) * 100,
      exchangeRate: inputAmount > 0 ? outputAmount / inputAmount : 0,
      fee: Math.floor(inputAmount * feeRate),
      minOutput,
      poolAddress: pool.address,
      dex: 'Tinyman v2 (on-chain)',
    };
  },

  async executeSwap(mnemonic, inputAssetId, outputAssetId, inputAmount, minOutputAmount, poolAddress, network): Promise<{ txId: string }> {
    const client = getAlgodClient(network);
    const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
    const appId = TINYMAN_APP_ID[network];
    const suggestedParams = await client.getTransactionParams().do();
    const txns: algosdk.Transaction[] = [];

    if (inputAssetId === 0) {
      txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: account.addr, receiver: poolAddress, amount: inputAmount, suggestedParams,
      }));
    } else {
      txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: account.addr, receiver: poolAddress, amount: inputAmount,
        assetIndex: inputAssetId, suggestedParams,
      }));
    }

    txns.push(algosdk.makeApplicationCallTxnFromObject({
      sender: account.addr, appIndex: appId,
      appArgs: [
        new TextEncoder().encode('swap'),
        new TextEncoder().encode('fixed-input'),
        algosdk.encodeUint64(minOutputAmount),
      ],
      foreignAssets: [
        ...(inputAssetId > 0 ? [inputAssetId] : []),
        ...(outputAssetId > 0 ? [outputAssetId] : []),
      ],
      accounts: [poolAddress],
      suggestedParams: { ...suggestedParams, fee: 8000 },
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
    }));

    algosdk.assignGroupID(txns);
    const signedTxns = txns.map(txn => txn.signTxn(account.sk));
    const { txid } = await client.sendRawTransaction(signedTxns).do();
    await algosdk.waitForConfirmation(client, txid, 6);
    return { txId: txid };
  },
};
