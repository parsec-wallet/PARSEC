// The Rust signing commands take a nested `args` struct with snake_case fields
// (`payload_b64`). Tauri renames only top-level command arguments, so a
// camelCase field inside `args` never arrives — every signature failed with
// "missing field `payload_b64`". These pin the shape each wrapper sends.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { cmd: string; args: unknown }[] = [];
vi.mock('../platform', () => ({
  isTauri: true,
  invoke: vi.fn(async (cmd: string, args: unknown) => { calls.push({ cmd, args }); return { signature_b64: '', scheme: 'ed25519' }; }),
}));

describe('signing wrappers send what Rust deserialises', () => {
  beforeEach(() => { calls.length = 0; });

  it('chain_algo_sign_transaction and chain_algo_sign_bytes', async () => {
    const { algoSignTransaction, algoSignBytes } = await import('../chain-algo');
    await algoSignTransaction('ADDR', 'AAAA');
    await algoSignBytes('ADDR', 'BBBB');
    expect(calls).toEqual([
      { cmd: 'chain_algo_sign_transaction', args: { args: { address: 'ADDR', payload_b64: 'AAAA' } } },
      { cmd: 'chain_algo_sign_bytes', args: { args: { address: 'ADDR', payload_b64: 'BBBB' } } },
    ]);
  });

  it('chain_sol_sign and chain_ar_sign', async () => {
    const { solSign } = await import('../chain-sol');
    const { arSign } = await import('../chain-ar');
    await solSign('SOL', 'CCCC');
    await arSign('AR', 'DDDD');
    expect(calls.map((c) => c.args)).toEqual([
      { args: { address: 'SOL', payload_b64: 'CCCC' } },
      { args: { address: 'AR', payload_b64: 'DDDD' } },
    ]);
  });
});
