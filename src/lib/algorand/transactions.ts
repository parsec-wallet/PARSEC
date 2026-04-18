// Parsec Wallet — Transaction Operations

import algosdk from 'algosdk';
import type { NetworkId, TransactionRecord } from '../../types/wallet';
import { getAlgodClient, getIndexerClient } from './client';

/** Send ALGO payment */
export async function sendPayment(
  mnemonic: string,
  receiver: string,
  amountMicroAlgos: number,
  note: string,
  network: NetworkId
): Promise<{ txId: string; confirmedRound: number }> {
  const client = getAlgodClient(network);
  const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
  try {
    const suggestedParams = await client.getTransactionParams().do();

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver,
      amount: amountMicroAlgos,
      note: note ? new TextEncoder().encode(note) : undefined,
      suggestedParams,
    });

    const signedTxn = txn.signTxn(account.sk);
    const { txid } = await client.sendRawTransaction(signedTxn).do();
    const result = await algosdk.waitForConfirmation(client, txid, 10);
    return { txId: txid, confirmedRound: Number(result.confirmedRound || 0) };
  } finally {
    // Zero secret key bytes — defense against memory scraping
    account.sk.fill(0);
  }
}

/** Send ASA transfer */
export async function sendAssetTransfer(
  mnemonic: string,
  receiver: string,
  amount: number,
  assetId: number,
  note: string,
  network: NetworkId
): Promise<{ txId: string; confirmedRound: number }> {
  const client = getAlgodClient(network);
  const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
  try {
    const suggestedParams = await client.getTransactionParams().do();

    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver,
      amount,
      assetIndex: assetId,
      note: note ? new TextEncoder().encode(note) : undefined,
      suggestedParams,
    });

    const signedTxn = txn.signTxn(account.sk);
    const { txid } = await client.sendRawTransaction(signedTxn).do();
    const result = await algosdk.waitForConfirmation(client, txid, 10);
    return { txId: txid, confirmedRound: Number(result.confirmedRound || 0) };
  } finally {
    account.sk.fill(0);
  }
}

/** Fetch recent transactions — all types including app calls and asset configs */
export async function fetchTransactions(
  address: string,
  network: NetworkId,
  limit = 50
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
