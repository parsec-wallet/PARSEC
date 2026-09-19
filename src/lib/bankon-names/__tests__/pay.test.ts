// A paid name claim needs one thing the wallet could not previously produce: the id of a
// transaction that paid the registry's treasury. These pin where that id comes from, and
// the two ways it can be wrong — a receipt that underpaid, and a receipt in the wrong asset.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const storage = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};

const TREASURY = 'AEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEA5RCDXMI';
const PAYER = 'AIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBMXPWWNQ';

const sent: Array<{ receiver: string; amount: bigint; note: string }> = [];

vi.mock('../client', () => ({
  getBnrInfo: async () => ({ treasury: { algorand: TREASURY, free: '' } }),
  getBankonTokenCost: async () => ({ method: 'algorand', amount: 1_000_000n, unit: 'microALGO' }),
}));

vi.mock('../../x402/rails/avm', () => ({
  sendAlgoPayment: async (_payer: string, receiver: string, amount: bigint, note: string) => {
    sent.push({ receiver, amount, note });
    return { txId: 'DIRECTTX', confirmedRound: 42 };
  },
}));

const { proofFromReceipts, payTreasury, quoteNameClaim, proveNameClaimPayment, treasuryFor } =
  await import('../pay');
const { recordReceipt, clearReceipts } = await import('../../x402/receipts');
const { ALGORAND_MAINNET } = await import('../../x402/networks');

function receipt(over: Record<string, unknown> = {}) {
  return {
    txId: 'X402TX',
    network: ALGORAND_MAINNET,
    url: 'https://names.example/claim',
    payer: PAYER,
    payTo: TREASURY,
    amount: '1000000',
    asset: '0',
    assetSymbol: 'ALGO',
    decimals: 6,
    scheme: 'exact',
    settledAt: new Date().toISOString(),
    delivered: true,
    ...over,
  } as never;
}

beforeEach(() => {
  clearReceipts();
  sent.length = 0;
});

describe('the treasury', () => {
  it('comes from the registry itself', async () => {
    expect(await treasuryFor('algorand')).toBe(TREASURY);
  });

  it('is an error, not an empty string, when a controller has not set one', async () => {
    await expect(treasuryFor('free')).rejects.toThrow(/no treasury address/i);
  });
});

describe('a proof from a settlement already on file', () => {
  it('is used when it covers the quote', () => {
    recordReceipt(receipt());
    const proof = proofFromReceipts(TREASURY, 1_000_000n, 'mainnet')!;
    expect(proof.txId).toBe('X402TX');
    expect(proof.source).toBe('x402-receipt');
    expect(proof.amount).toBe(1_000_000n);
  });

  it('is refused when it paid less than the quote', () => {
    // A real payment to the same treasury, for something cheaper. It is not payment
    // for this.
    recordReceipt(receipt({ amount: '999999' }));
    expect(proofFromReceipts(TREASURY, 1_000_000n, 'mainnet')).toBeNull();
  });

  it('is refused when it was paid in the wrong asset', () => {
    // `Payment-Amount` is denominated in microALGO; a USDC receipt would read as a
    // shortfall to the registry's verifier.
    recordReceipt(receipt({ asset: '31566704', assetSymbol: 'USDC' }));
    expect(proofFromReceipts(TREASURY, 1_000_000n, 'mainnet')).toBeNull();
  });

  it('is refused when it paid somebody else', () => {
    recordReceipt(receipt({ payTo: 'SOMEONE-ELSE' }));
    expect(proofFromReceipts(TREASURY, 1_000_000n, 'mainnet')).toBeNull();
  });

  it('is refused when it settled on another network', () => {
    recordReceipt(receipt());
    expect(proofFromReceipts(TREASURY, 1_000_000n, 'testnet')).toBeNull();
  });
});

describe('paying directly', () => {
  it('sends the quote to the treasury and notes the name', async () => {
    const proof = await payTreasury(PAYER, TREASURY, 1_000_000n, 'alice', 'mainnet');
    expect(sent).toEqual([{ receiver: TREASURY, amount: 1_000_000n, note: 'bnr:claim:alice' }]);
    expect(proof).toMatchObject({ txId: 'DIRECTTX', source: 'direct', method: 'algorand' });
  });

  it('refuses a zero quote rather than sending an empty payment', async () => {
    await expect(payTreasury(PAYER, TREASURY, 0n, 'alice', 'mainnet')).rejects.toThrow(/positive quote/);
  });
});

describe('quoting and proving together', () => {
  it('reports what is owed, and that nothing is owed when it is already paid', async () => {
    const owed = await quoteNameClaim('Buy-Name', 'alice', { paymentMethod: 'algorand' }, 'mainnet');
    expect(owed.amount).toBe(1_000_000n);
    expect(owed.treasury).toBe(TREASURY);
    expect(owed.existing).toBeNull();

    recordReceipt(receipt());
    const settled = await quoteNameClaim('Buy-Name', 'alice', { paymentMethod: 'algorand' }, 'mainnet');
    expect(settled.existing?.txId).toBe('X402TX');
  });

  it('does not pay twice', async () => {
    recordReceipt(receipt());
    const quote = await quoteNameClaim('Buy-Name', 'alice', { paymentMethod: 'algorand' }, 'mainnet');
    const proof = await proveNameClaimPayment(PAYER, quote, 'alice', 'mainnet');
    expect(proof.txId).toBe('X402TX');
    expect(sent).toHaveLength(0);
  });

  it('pays when there is nothing on file', async () => {
    const quote = await quoteNameClaim('Buy-Name', 'alice', { paymentMethod: 'algorand' }, 'mainnet');
    const proof = await proveNameClaimPayment(PAYER, quote, 'alice', 'mainnet');
    expect(proof.source).toBe('direct');
    expect(sent).toHaveLength(1);
  });
});
