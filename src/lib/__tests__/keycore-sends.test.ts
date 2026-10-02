import { describe, it, expect, vi, beforeEach } from 'vitest';
import algosdk from 'algosdk';

// The algod client is replaced: these tests are about who signs, not about the network.
const sent: Uint8Array[] = [];
vi.mock('../algorand/client', () => ({
  getAlgodClient: () => ({
    getTransactionParams: () => ({ do: async () => ({
      fee: 1000n, minFee: 1000n, firstValid: 1000n, lastValid: 2000n,
      genesisID: 'mainnet-v1.0', genesisHash: new Uint8Array(32),
    }) }),
    sendRawTransaction: (b: Uint8Array) => { sent.push(b); return { do: async () => ({ txid: 'TXID' }) }; },
    // What algosdk.waitForConfirmation asks: the node's round, then the transaction's.
    status: () => ({ do: async () => ({ lastRound: 41n }) }),
    pendingTransactionInformation: () => ({ do: async () => ({ confirmedRound: 42n, poolError: '' }) }),
    statusAfterBlock: () => ({ do: async () => ({ lastRound: 42n }) }),
  }),
  getIndexerClient: () => ({}),
}));

const { sendPayment, sendAssetTransfer } = await import('../algorand/transactions');
const { optOutFromAsset } = await import('../algorand/assets');

const SENDER = algosdk.generateAccount().addr.toString();
const RECEIVER = algosdk.generateAccount().addr.toString();

function fakeKeycore() {
  const seen: algosdk.Transaction[] = [];
  return {
    seen,
    signer: {
      address: SENDER,
      sign: async (group: algosdk.Transaction[], idx: number[]) => { idx.forEach((i) => seen.push(group[i])); return idx.map(() => new Uint8Array([1, 2, 3])); },
      dispose: () => {},
    },
  };
}

describe('Algorand sends are signed by the Keycore signer, never from a phrase', () => {
  beforeEach(() => { sent.length = 0; });

  it('ALGO payment: built from the signer\'s address, signed by it, its bytes submitted', async () => {
    const k = fakeKeycore();
    const r = await sendPayment(k.signer, RECEIVER, 1_500_000, 'hi', 'mainnet');
    expect(r).toEqual({ txId: 'TXID', confirmedRound: 42 });
    expect(k.seen).toHaveLength(1);
    expect(k.seen[0].sender.toString()).toBe(SENDER);
    expect(k.seen[0].payment?.amount).toBe(1_500_000n);
    expect(sent).toEqual([new Uint8Array([1, 2, 3])]);
  });

  it('ASA transfer and opt-out go through the same signer', async () => {
    const k = fakeKeycore();
    await sendAssetTransfer(k.signer, RECEIVER, 5, 31566704, '', 'mainnet');
    await optOutFromAsset(k.signer, 31566704, RECEIVER, 'mainnet');
    expect(k.seen.map((t) => t.assetTransfer?.assetIndex)).toEqual([31566704n, 31566704n]);
    expect(k.seen[1].assetTransfer?.closeRemainderTo?.toString()).toBe(RECEIVER);
    expect(sent).toHaveLength(2);
  });

  it('the send functions take no phrase at all', () => {
    // A phrase-taking signature would make the first parameter a string.
    expect(sendPayment.length).toBe(5);
    expect(String(sendPayment)).not.toMatch(/mnemonicToSecretKey/);
    expect(String(sendAssetTransfer)).not.toMatch(/mnemonicToSecretKey/);
    expect(String(optOutFromAsset)).not.toMatch(/mnemonicToSecretKey/);
  });
});
