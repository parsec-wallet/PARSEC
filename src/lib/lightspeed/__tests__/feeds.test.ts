import { describe, it, expect, vi, afterEach } from 'vitest';
import { blockNumber$, erc20, post$, readBlockNumber, encodeAddressArg, ERC20_BALANCE_OF } from '../feeds';
import { jsonRpcProvider } from '../providers/json-rpc';
import { localProvider } from '../providers/local';
import { activeProvider, getProviderChoice } from '../registry';
import { PrivilegeError } from '../../module-choices';

afterEach(() => vi.useRealTimers());

const ADDR = '0x407d73d8a49eeb85d32cf465507dd71d507100c1';

function fakeFetch(reply: (method: string, params: unknown[]) => unknown): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: reply(body.method, body.params) }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('the local default', () => {
  it('is what runs when nothing was chosen (no storage here at all)', () => {
    expect(getProviderChoice().id).toBe('local');
    expect(activeProvider()).toBe(localProvider);
  });

  it('answers unknown from this device — absence is not a fault', async () => {
    const r = await readBlockNumber();
    expect(r.status).toBe('unknown');
    expect(r.provenance.reach).toBe('internal');
    expect(r.provenance.origin).toBe('this device');
  });

  it('blockNumber$ streams that same truth', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const off = blockNumber$().subscribe((r) => seen.push(r.status));
    await vi.advanceTimersByTimeAsync(0);
    off();
    expect(seen).toEqual(['unknown']);
  });
});

describe('json-rpc provider', () => {
  it('decodes quantities, states its host as origin, and is external reach', async () => {
    const p = jsonRpcProvider('https://rpc.example.org', fakeFetch((m) => {
      if (m === 'eth_blockNumber') return '0x10';
      if (m === 'eth_chainId') return '0x2105';
      if (m === 'eth_getBalance') return '0xde0b6b3a7640000';
      if (m === 'eth_syncing') return { currentBlock: '0x5', highestBlock: '0x9' };
      return '0x';
    }));
    expect(p.origin).toBe('rpc.example.org');
    expect(p.reach).toBe('external');
    expect(await p.blockNumber()).toBe(16n);
    expect(await p.chainId()).toBe(8453n);
    expect(await p.balanceOf(ADDR)).toBe(10n ** 18n);
    expect(await p.syncStatus()).toEqual({ syncing: true, current: 5n, highest: 9n });
  });

  it('rejects a bad address before it leaves the device', async () => {
    const p = jsonRpcProvider('https://rpc.example.org', fakeFetch(() => '0x0'));
    await expect(p.balanceOf('not-an-address')).rejects.toThrow('invalid EVM address');
  });

  it('refuses a non-http endpoint', () => {
    expect(() => jsonRpcProvider('ws://127.0.0.1:8546')).toThrow('http(s)');
  });

  it('surfaces an RPC error as a failure, not an absence', async () => {
    const f = (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'header not found' } }))) as unknown as typeof fetch;
    const p = jsonRpcProvider('https://rpc.example.org', f);
    await expect(p.blockNumber()).rejects.toThrow('header not found');
  });
});

describe('makeContract — read half of light.js tutorial 5', () => {
  it('encodes balanceOf(address) as selector + padded word', () => {
    const data = encodeAddressArg(ERC20_BALANCE_OF, ADDR);
    expect(data).toBe(ERC20_BALANCE_OF + ADDR.slice(2).padStart(64, '0'));
  });

  it('exposes balanceOf$ that stays unknown on the local provider', async () => {
    vi.useFakeTimers();
    const token = erc20('0x4733659a5cB7896A65c918Add6f59C5148FB5ffa');
    const seen: string[] = [];
    const off = token.balanceOf$(ADDR).subscribe((r) => seen.push(r.status));
    await vi.advanceTimersByTimeAsync(0);
    off();
    expect(seen).toEqual(['unknown']);
  });
});

describe('post$ — the privilege boundary', () => {
  it('throws a PrivilegeError: lightspeed declared observe and may not sign', () => {
    expect(() => post$()).toThrow(PrivilegeError);
    expect(() => post$()).toThrow(/"observe".*"sign"/);
  });
});
