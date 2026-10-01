// SpinTrade — Pact DEX Module
// On-chain constant-product AMM. Second major Algorand DEX.
// All data read from Algod + Indexer. No third-party API.

import algosdk from 'algosdk';
import type { NetworkId } from '../../types/wallet';
import type { DexModule, DexQuote, DexAsset } from './types';
import { getAlgodClient, getIndexerClient } from '../algorand/client';

const PACT_APP_ID: Record<NetworkId, number> = {
  mainnet: 1167966498,
  testnet: 612838176,
  betanet: 0,
};

/** Known Pact pools for fast discovery fallback */
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
    { assetId: 386192725, unitName: 'goBTC', name: 'goBTC', decimals: 8 },
    { assetId: 386195940, unitName: 'goETH', name: 'goETH', decimals: 8 },
  ];
  return known.filter(a => a.assetId !== assetId);
}

/** Find a Pact pool and read its reserves */
async function findPoolAndReserves(
  inputAssetId: number,
  outputAssetId: number,
  network: NetworkId,
): Promise<{ address: string; inputReserve: number; outputReserve: number } | null> {
  const appId = PACT_APP_ID[network];
  if (!appId) return null;

  const indexer = getIndexerClient(network);
  const algod = getAlgodClient(network);

  const [a1, a2] = inputAssetId < outputAssetId
    ? [inputAssetId, outputAssetId]
    : [outputAssetId, inputAssetId];

  try {
    const searchAsset = a2 > 0 ? a2 : a1;
    const txResponse = await indexer
      .searchForTransactions()
      .applicationID(appId)
      .txType('axfer')
      .assetID(searchAsset > 0 ? searchAsset : undefined as unknown as number)
      .limit(15)
      .do();

    const candidates = new Set<string>();
    for (const tx of txResponse.transactions || []) {
      const axfer = tx.assetTransferTransaction as Record<string, unknown> | undefined;
      const receiver = String(axfer?.receiver || '');
      if (receiver && receiver !== String(tx.sender || '')) {
        candidates.add(receiver);
      }
    }

    for (const addr of candidates) {
      try {
        const acctInfo = await algod.accountInformation(addr).do();
        const appsLocal = (acctInfo as unknown as { appsLocalState?: { id: unknown }[] }).appsLocalState || [];
        const isPool = appsLocal.some(app => Number(app.id) === appId);
        if (!isPool) continue;

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

export const pactModule: DexModule = {
  id: 'pact',
  name: 'Pact (on-chain)',
  enabled: true,

  async fetchPairsForAsset(assetId: number, network: NetworkId): Promise<DexAsset[]> {
    const appId = PACT_APP_ID[network];
    if (!appId) return getKnownPairs(assetId, network);

    const indexer = getIndexerClient(network);
    const algod = getAlgodClient(network);
    const discovered: DexAsset[] = [];
    const seenIds = new Set<number>();

    try {
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
    } catch { /* fall through */ }

    for (const known of getKnownPairs(assetId, network)) {
      if (!seenIds.has(known.assetId)) {
        seenIds.add(known.assetId);
        discovered.push(known);
      }
    }

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

    // Enrich with pool reserves
    for (const asset of discovered) {
      try {
        const pool = await findPoolAndReserves(assetId, asset.assetId, network);
        if (pool && pool.inputReserve > 0 && pool.outputReserve > 0) {
          const inputDec = assetId === 0 ? 6 : 6;
          const outputDec = asset.decimals;
          const inputReserveHuman = pool.inputReserve / Math.pow(10, inputDec);
          const outputReserveHuman = pool.outputReserve / Math.pow(10, outputDec);

          asset.poolReserveThis = pool.outputReserve;
          asset.poolReserveOther = pool.inputReserve;
          asset.poolPrice = outputReserveHuman / inputReserveHuman;
          asset.poolLiquidity = `${inputReserveHuman.toFixed(2)} / ${outputReserveHuman.toFixed(2)}`;
        }
      } catch { /* show without liquidity */ }
    }

    return discovered;
  },

  async getQuote(inputAssetId, outputAssetId, inputAmount, slippageBps, network): Promise<DexQuote | null> {
    const pool = await findPoolAndReserves(inputAssetId, outputAssetId, network);
    if (!pool || pool.inputReserve === 0 || pool.outputReserve === 0) return null;

    // Pact uses 0.3% fee (same constant-product as Tinyman)
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
      dex: 'Pact',
      dexId: 'pact',
    };
  },

  async executeSwap(signer, inputAssetId, outputAssetId, inputAmount, minOutputAmount, poolAddress, network): Promise<{ txId: string }> {
    const client = getAlgodClient(network);
    const sender = signer.address;
    const appId = PACT_APP_ID[network];
    const suggestedParams = await client.getTransactionParams().do();
    const txns: algosdk.Transaction[] = [];

    // Fund the pool with input asset
    if (inputAssetId === 0) {
      txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: sender, receiver: poolAddress, amount: inputAmount, suggestedParams,
      }));
    } else {
      txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: sender, receiver: poolAddress, amount: inputAmount,
        assetIndex: inputAssetId, suggestedParams,
      }));
    }

    // App call to execute the swap
    txns.push(algosdk.makeApplicationCallTxnFromObject({
      sender: sender, appIndex: appId,
      appArgs: [
        new TextEncoder().encode('SWAP'),
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
    // Every transaction in the group is the swapper's; the Keycore signs them.
    const signedTxns = await signer.sign(txns, txns.map((_, i) => i));
    const { txid } = await client.sendRawTransaction(signedTxns).do();
    await algosdk.waitForConfirmation(client, txid, 6);
    return { txId: txid };
  },
};
