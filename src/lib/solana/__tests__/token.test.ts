// SPL token balance reads — parse shapes from getTokenAccountsByOwner (jsonParsed).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTokenBalance, ARIO_MINT } from '../token';

function rpcResponse(accounts: Array<{ amount: string; decimals: number }>) {
  return {
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: {
        value: accounts.map((a) => ({
          account: { data: { parsed: { info: { tokenAmount: { amount: a.amount, decimals: a.decimals, uiAmountString: '' } } } } },
        })),
      },
    }),
  } as Response;
}

afterEach(() => vi.restoreAllMocks());

describe('getTokenBalance', () => {
  it('sums multiple token accounts and formats ui amount at the mint decimals', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      rpcResponse([{ amount: '100152172683', decimals: 6 }, { amount: '827317', decimals: 6 }]),
    );
    const bal = await getTokenBalance('SomeOwner11111111111111111111111111111111111');
    expect(bal.amount).toBe(100152172683n + 827317n);
    expect(bal.decimals).toBe(6);
    expect(bal.uiAmountString).toBe('100153.000000');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.method).toBe('getTokenAccountsByOwner');
    expect(body.params[1]).toEqual({ mint: ARIO_MINT });
  });

  it('zero accounts → 0n with default decimals', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(rpcResponse([]));
    const bal = await getTokenBalance('Owner');
    expect(bal.amount).toBe(0n);
    expect(bal.uiAmountString).toBe('0.000000');
  });

  it('propagates RPC-level errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'rate limited' } }),
    } as Response);
    await expect(getTokenBalance('Owner')).rejects.toThrow('rate limited');
  });
});
