import { describe, expect, it } from 'vitest';
import { classifyAddress, confirmChain, digitsOf, formatReading, readWatched, sanitizeWatched } from '../watch';

const ALGO = 'ABIZJORU6VRN4U5G2WZX2DEZ2WBWKWRRCTHCWH2TRMG3ZYAOCDNRNSWKHA';
const EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const SOL = 'Vote111111111111111111111111111111111111111';

function text(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 500, text: async () => body } as unknown as Response;
}

const ok = (chain: string) => async (a: string) => ({ valid: true, chain, address: a, reason: 'ok' });
const validators = { algorand: ok('algorand'), solana: ok('solana'), bitcoin: ok('bitcoin'), evm: ok('evm') };

describe('classifyAddress', () => {
  it('suggests each chain by format', () => {
    expect(classifyAddress(ALGO)).toEqual(['algorand']);
    expect(classifyAddress(EVM)).toEqual(['evm']);
    expect(classifyAddress(BTC)).toEqual(['bitcoin']);
    expect(classifyAddress('')).toEqual([]);
  });

  it('offers both when a string fits Solana and Arweave, rather than guessing', () => {
    expect(classifyAddress(SOL)).toEqual(['solana', 'arweave']);
  });
});

describe('confirmChain', () => {
  it('defers to the validator for checksummed chains', async () => {
    const bad = { ...validators, algorand: async (a: string) => ({ valid: false, chain: 'algorand', address: a, reason: 'bad checksum' }) };
    expect(await confirmChain('algorand', ALGO, bad)).toEqual({ ok: false, reason: 'bad checksum' });
    expect((await confirmChain('evm', EVM, validators)).ok).toBe(true);
  });

  it('refuses a chain the format does not fit, without calling the validator', async () => {
    expect((await confirmChain('bitcoin', EVM, validators)).ok).toBe(false);
  });

  it('accepts Arweave on format and says it could not verify more', async () => {
    const r = await confirmChain('arweave', SOL, validators);
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/no checksum/);
  });
});

describe('reading balances exactly', () => {
  it('lifts amounts as digits, beyond 2^53', () => {
    expect(digitsOf('{"amount": 10000000000000001, "x":1}', 'amount')).toBe(10000000000000001n);
    expect(digitsOf('{"amount-without-pending-rewards":5}', 'amount')).toBeNull();
  });

  it('reads Algorand in microAlgos and formats exactly', async () => {
    const [r] = await readWatched({ chain: 'algorand', address: ALGO, label: '' },
      (async () => text('{"address":"x","amount":1234567891,"amount-without-pending-rewards":1}')) as unknown as typeof fetch);
    expect(r.raw).toBe(1234567891n);
    expect(formatReading(r)).toBe('1234.567891 ALGO');
  });

  it('reads Bitcoin as funded minus spent, confirmed only', async () => {
    const [r] = await readWatched({ chain: 'bitcoin', address: BTC, label: '' },
      (async () => text('{"chain_stats":{"funded_txo_sum":1679253070,"spent_txo_sum":1287005839},"mempool_stats":{"funded_txo_sum":99}}')) as unknown as typeof fetch);
    expect(r.raw).toBe(392247231n);
    expect(formatReading(r)).toBe('3.92247231 BTC');
  });

  it('reads an EVM address on every network and keeps failures unknown', async () => {
    const rs = await readWatched({ chain: 'evm', address: EVM, label: '' },
      (async (url: string) => String(url).includes('blast')
        ? text('', false)
        : text('{"jsonrpc":"2.0","id":1,"result":"0xde0b6b3a7640000"}')) as unknown as typeof fetch);
    expect(rs.length).toBe(7);
    expect(rs.find((r) => r.network === 'Ethereum')!.raw).toBe(10n ** 18n);
    const blast = rs.find((r) => r.network === 'Blast')!;
    expect(blast.raw).toBeNull();
    expect(formatReading(blast)).toBe('—');
  });

  it('turns a thrown fetch into an unknown reading, never zero', async () => {
    const [r] = await readWatched({ chain: 'arweave', address: SOL, label: '' },
      (async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(r.raw).toBeNull();
    expect(r.error).toBe('offline');
  });
});

describe('sanitizeWatched', () => {
  it('rejects mismatched chain and address, trims labels', () => {
    expect(sanitizeWatched({ chain: 'algorand', address: EVM })).toBeNull();
    expect(sanitizeWatched({ chain: 'evm', address: ` ${EVM} `, label: 'x'.repeat(60) })!.label).toHaveLength(40);
  });
});
