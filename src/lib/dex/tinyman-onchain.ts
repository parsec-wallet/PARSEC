// SpinTrade — Tinyman v2, read and traded on chain.
//
// A Tinyman v2 pool is a logic-signature account whose program is a fixed
// template with the validator app id and the two asset ids written into it
// (Tinyman's SDK: tinyman/v2/contracts.py, get_pool_logicsig). So a pool's
// address is derived, not looked up, and its reserves and fee are read from
// the pool's local state in the validator app — the chain is the source, no
// API is trusted for either.
//
//   asset_1 = the larger asset id, asset_2 = the smaller (ALGO is 0)
//   quote   = fixed-input: fee = in × total_fee_share / 10 000; the rest
//             swaps against the constant product; all bigint
//   swap    = [transfer in → pool, app call "swap" "fixed-input" min_out],
//             foreign assets [asset_1, asset_2], the pool as account, the
//             app call paying 2 × min fee (it makes one inner transfer)
//
// Signing is the caller's SwapSigner (the PARSEC Keycore); no key here.

import algosdk from 'algosdk';
import type { NetworkId } from '../../types/wallet';
import type { DexModule, DexQuote, DexAsset } from './types';
import { getAlgodClient } from '../algorand/client';
import { standardAssets } from '../algorand/asset-whitelist';

const TINYMAN_APP_ID: Record<NetworkId, number> = {
  mainnet: 1002541853,
  testnet: 148607000,
  betanet: 0,
};

/** Tinyman v2 pool logic-signature template (tinyman-py-sdk, tinyman/v2/constants.py). */
const POOL_LOGICSIG_TEMPLATE = 'BoAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgQBbNQA0ADEYEkQxGYEBEkSBAUM=';

function u64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
}

/** The v2 pool address for a pair: the template with app id and asset ids written in. */
export function tinymanPoolAddress(appId: number, assetA: number, assetB: number): string {
  const program = Uint8Array.from(atob(POOL_LOGICSIG_TEMPLATE), (c) => c.charCodeAt(0));
  program.set(u64(appId), 3);
  program.set(u64(Math.max(assetA, assetB)), 11);
  program.set(u64(Math.min(assetA, assetB)), 19);
  return new algosdk.LogicSigAccount(program).address().toString();
}

interface PoolState {
  address: string;
  asset1: number;
  asset2: number;
  reserve1: bigint;
  reserve2: bigint;
  feeBps: bigint;
}

/** Read a pool's state from chain; null when the pair has no bootstrapped v2 pool. */
async function readPool(a: number, b: number, network: NetworkId): Promise<PoolState | null> {
  const appId = TINYMAN_APP_ID[network];
  if (!appId) return null;
  const address = tinymanPoolAddress(appId, a, b);
  try {
    const info = await getAlgodClient(network).accountApplicationInformation(address, appId).do();
    const kv = (info.appLocalState?.keyValue ?? []) as { key: Uint8Array | string; value: { uint: bigint | number } }[];
    const state = new Map<string, bigint>();
    for (const e of kv) {
      const key = typeof e.key === 'string' ? atob(e.key) : new TextDecoder().decode(e.key);
      state.set(key, BigInt(e.value.uint ?? 0));
    }
    const asset1 = Number(state.get('asset_1_id') ?? -1n);
    const asset2 = Number(state.get('asset_2_id') ?? -1n);
    if (asset1 !== Math.max(a, b) || asset2 !== Math.min(a, b)) return null;
    return {
      address, asset1, asset2,
      reserve1: state.get('asset_1_reserves') ?? 0n,
      reserve2: state.get('asset_2_reserves') ?? 0n,
      feeBps: state.get('total_fee_share') ?? 30n,
    };
  } catch {
    return null; // no such account, or not opted in to the validator: no pool
  }
}

function reservesFor(pool: PoolState, inputAssetId: number): { inR: bigint; outR: bigint } {
  return inputAssetId === pool.asset1
    ? { inR: pool.reserve1, outR: pool.reserve2 }
    : { inR: pool.reserve2, outR: pool.reserve1 };
}

/** Fixed-input swap output, as the validator computes it. */
export function fixedInputOut(amountIn: bigint, inR: bigint, outR: bigint, feeBps: bigint): bigint {
  if (amountIn <= 0n || inR <= 0n || outR <= 0n) return 0n;
  const fee = (amountIn * feeBps) / 10_000n;
  const swapIn = amountIn - fee;
  return (outR * swapIn) / (inR + swapIn);
}

/** Candidates for "what can this asset be swapped to": ALGO and the verified list. */
function candidates(assetId: number, network: NetworkId): DexAsset[] {
  const list: DexAsset[] = [{ assetId: 0, unitName: 'ALGO', name: 'Algorand', decimals: 6 }];
  for (const s of standardAssets(network)) list.push({ assetId: s.assetId, unitName: s.unitName, name: s.name, decimals: s.decimals });
  return list.filter((a) => a.assetId !== assetId);
}

export const tinymanOnchainModule: DexModule = {
  id: 'tinyman-onchain',
  name: 'Tinyman v2 (on-chain)',
  enabled: true,

  async fetchPairsForAsset(assetId: number, network: NetworkId): Promise<DexAsset[]> {
    // One chain read per candidate, in parallel: a pair is listed only if its
    // v2 pool exists and holds liquidity.
    const found = await Promise.all(candidates(assetId, network).map(async (c) => {
      const pool = await readPool(assetId, c.assetId, network);
      if (!pool) return null;
      const { inR, outR } = reservesFor(pool, assetId);
      if (inR === 0n || outR === 0n) return null;
      return {
        ...c,
        poolReserveThis: Number(outR),
        poolReserveOther: Number(inR),
        poolLiquidity: `${(Number(outR) / 10 ** c.decimals).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${c.unitName} in pool`,
      } as DexAsset;
    }));
    return found.filter((a): a is DexAsset => a !== null);
  },

  async getQuote(inputAssetId, outputAssetId, inputAmount, slippageBps, network): Promise<DexQuote | null> {
    const pool = await readPool(inputAssetId, outputAssetId, network);
    if (!pool) return null;
    const { inR, outR } = reservesFor(pool, inputAssetId);
    const amountIn = BigInt(Math.floor(inputAmount));
    const out = fixedInputOut(amountIn, inR, outR, pool.feeBps);
    if (out <= 0n) return null;
    const minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
    // Impact: how far this trade's price is from the pool's spot price, fee
    // aside (the fee is reported on its own).
    const swapIn = amountIn - (amountIn * pool.feeBps) / 10_000n;
    const spotOut = inR > 0n ? (swapIn * outR) / inR : 0n;
    const impact = spotOut > 0n ? Number(((spotOut - out) * 1_000_000n) / spotOut) / 10_000 : 0;
    return {
      inputAssetId, outputAssetId,
      inputAmount: Number(amountIn),
      outputAmount: Number(out),
      priceImpact: impact,
      exchangeRate: Number(out) / Number(amountIn),
      fee: Number((amountIn * pool.feeBps) / 10_000n),
      minOutput: Number(minOut),
      poolAddress: pool.address,
      dex: 'Tinyman v2',
      dexId: 'tinyman-onchain',
    };
  },

  async executeSwap(signer, inputAssetId, outputAssetId, inputAmount, minOutputAmount, poolAddress, network): Promise<{ txId: string }> {
    const client = getAlgodClient(network);
    const appId = TINYMAN_APP_ID[network];
    // The pool must be the derived v2 pool for this pair — never an address from elsewhere.
    const expected = tinymanPoolAddress(appId, inputAssetId, outputAssetId);
    if (poolAddress !== expected) throw new Error('The quoted pool is not the Tinyman v2 pool for this pair.');
    const sender = signer.address;
    const sp = await client.getTransactionParams().do();
    const asset1 = Math.max(inputAssetId, outputAssetId);
    const asset2 = Math.min(inputAssetId, outputAssetId);

    const transferIn = inputAssetId === 0
      ? algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender, receiver: poolAddress, amount: inputAmount, suggestedParams: sp })
      : algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender, receiver: poolAddress, amount: inputAmount, assetIndex: inputAssetId, suggestedParams: sp });
    const minFee = BigInt(sp.minFee ?? 1000);
    const call = algosdk.makeApplicationCallTxnFromObject({
      sender, appIndex: appId,
      appArgs: [new TextEncoder().encode('swap'), new TextEncoder().encode('fixed-input'), algosdk.encodeUint64(minOutputAmount)],
      foreignAssets: [asset1, asset2],
      accounts: [poolAddress],
      suggestedParams: { ...sp, flatFee: true, fee: minFee * 2n },
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
    });
    const txns = [transferIn, call];
    algosdk.assignGroupID(txns);
    // Every transaction in the group is the swapper's; the Keycore signs them.
    const signed = await signer.sign(txns, [0, 1]);
    const { txid } = await client.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(client, txid, 6);
    return { txId: txid };
  },
};
