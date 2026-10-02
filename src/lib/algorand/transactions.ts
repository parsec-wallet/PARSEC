// PARSEC Wallet — Transaction Operations

import algosdk from 'algosdk';
import type { NetworkId, TransactionRecord } from '../../types/wallet';
import { getAlgodClient, getIndexerClient } from './client';
import { rateLimitedQuery } from './query-cache';
import type { WalletSigner } from './signer';

/**
 * Sign and submit one transaction with a wallet signer, and wait for it to confirm.
 *
 * The signer is the PARSEC Keycore's on desktop and phone (`walletSigner`): the transaction
 * is built here, signed in Rust, and only the signature comes back — no recovery phrase or
 * key ever enters JavaScript. (The browser build's signer is its documented exception.)
 */
async function submitSigned(
  signer: WalletSigner,
  txn: algosdk.Transaction,
  network: NetworkId,
): Promise<{ txId: string; confirmedRound: number }> {
  const client = getAlgodClient(network);
  const [signed] = await signer.sign([txn], [0]);
  const { txid } = await client.sendRawTransaction(signed).do();
  const result = await algosdk.waitForConfirmation(client, txid, 10);
  return { txId: txid, confirmedRound: Number(result.confirmedRound || 0) };
}

/** Send ALGO from `signer.address`. */
export async function sendPayment(
  signer: WalletSigner,
  receiver: string,
  amountMicroAlgos: number,
  note: string,
  network: NetworkId
): Promise<{ txId: string; confirmedRound: number }> {
  const suggestedParams = await getAlgodClient(network).getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: signer.address,
    receiver,
    amount: amountMicroAlgos,
    note: note ? new TextEncoder().encode(note) : undefined,
    suggestedParams,
  });
  return submitSigned(signer, txn, network);
}

/** Send an ASA from `signer.address`. */
export async function sendAssetTransfer(
  signer: WalletSigner,
  receiver: string,
  amount: number,
  assetId: number,
  note: string,
  network: NetworkId
): Promise<{ txId: string; confirmedRound: number }> {
  const suggestedParams = await getAlgodClient(network).getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: signer.address,
    receiver,
    amount,
    assetIndex: assetId,
    note: note ? new TextEncoder().encode(note) : undefined,
    suggestedParams,
  });
  return submitSigned(signer, txn, network);
}

/** Fetch recent transactions — all types including app calls and asset configs.
 *  Cached briefly (15s) and dedup'd: rapid dashboard re-renders don't re-fetch. */
export async function fetchTransactions(
  address: string,
  network: NetworkId,
  limit = 50
): Promise<TransactionRecord[]> {
  return rateLimitedQuery(
    `indexer:${network}`,
    `txns:${address}@${network}:${limit}`,
    15_000,
    () => doFetchTransactions(address, network, limit),
  );
}

async function doFetchTransactions(
  address: string,
  network: NetworkId,
  limit: number,
): Promise<TransactionRecord[]> {
  const indexer = getIndexerClient(network);
  const response = await indexer.searchForTransactions().address(address).limit(limit).do();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (response.transactions || []).map((tx: any) => {
    const paymentTx = tx.paymentTransaction;
    const assetTx = tx.assetTransferTransaction;
    const appTx = tx.applicationTransaction;

    // Determine receiver based on tx type
    let receiver = '';
    if (paymentTx?.receiver) receiver = String(paymentTx.receiver);
    else if (assetTx?.receiver) receiver = String(assetTx.receiver);
    else if (appTx?.applicationId) receiver = `App #${appTx.applicationId}`;

    // Amount based on type
    let amount = 0;
    if (paymentTx?.amount) amount = Number(paymentTx.amount);
    else if (assetTx?.amount) amount = Number(assetTx.amount);

    return {
      id: String(tx.id || ''),
      type: (String(tx.txType || 'pay')) as TransactionRecord['type'],
      sender: tx.sender ? String(tx.sender) : '',
      receiver,
      amount,
      fee: Number(tx.fee || 0),
      note: tx.note ? new TextDecoder().decode(tx.note as Uint8Array) : undefined,
      assetId: assetTx?.assetId ? Number(assetTx.assetId) : undefined,
      appId: appTx?.applicationId ? Number(appTx.applicationId) : undefined,
      createdAssetId: tx.createdAssetIndex ? Number(tx.createdAssetIndex) : undefined,
      createdAppId: tx.createdApplicationIndex ? Number(tx.createdApplicationIndex) : undefined,
      confirmedRound: Number(tx.confirmedRound || 0),
      roundTime: Number(tx.roundTime || 0),
      group: tx.group ? String(tx.group) : undefined,
    };
  });
}

/** Validate an Algorand address */
export function isValidAddress(address: string): boolean {
  return algosdk.isValidAddress(address);
}
