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

/** Fetch recent transactions */
export async function fetchTransactions(
  address: string,
  network: NetworkId,
  limit = 20
): Promise<TransactionRecord[]> {
  const indexer = getIndexerClient(network);
  const response = await indexer.searchForTransactions().address(address).limit(limit).do();

  return (response.transactions || []).map((tx) => {
    const paymentTx = tx.paymentTransaction;
    const assetTx = tx.assetTransferTransaction;
    return {
      id: tx.id || '',
      type: (tx.txType || 'pay') as TransactionRecord['type'],
      sender: tx.sender?.toString() || '',
      receiver: paymentTx?.receiver?.toString() || assetTx?.receiver?.toString() || '',
      amount: Number(paymentTx?.amount || assetTx?.amount || 0),
      fee: Number(tx.fee || 0),
      note: tx.note ? new TextDecoder().decode(tx.note) : undefined,
      assetId: assetTx?.assetId ? Number(assetTx.assetId) : undefined,
      confirmedRound: Number(tx.confirmedRound || 0),
      roundTime: Number(tx.roundTime || 0),
    };
  });
}

/** Validate an Algorand address */
export function isValidAddress(address: string): boolean {
  return algosdk.isValidAddress(address);
}
