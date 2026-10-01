// Solana transfer serializer — verifies the hand-rolled shortvec encoding
// and legacy-message layout. Parsec builds the System Program transfer by
// hand (no @solana/web3.js), so this guards the wire format directly.

import { describe, it, expect } from 'vitest';
import { compactU16, buildTransferMessage } from '../transfer';

describe('compactU16 (shortvec)', () => {
  it('encodes single-byte values', () => {
    expect([...compactU16(0)]).toEqual([0]);
    expect([...compactU16(1)]).toEqual([1]);
    expect([...compactU16(127)]).toEqual([127]);
  });

  it('encodes multi-byte values with continuation bits', () => {
    expect([...compactU16(128)]).toEqual([0x80, 0x01]);
    expect([...compactU16(300)]).toEqual([0xac, 0x02]);
  });
});

describe('buildTransferMessage', () => {
  const from = new Uint8Array(32).fill(1);
  const to = new Uint8Array(32).fill(2);
  const blockhash = new Uint8Array(32).fill(3);

  it('serializes a single-instruction transfer with the expected layout', () => {
    const lamports = 123_456_789n;
    const msg = buildTransferMessage(from, to, lamports, blockhash);

    // header(3) + accounts(1 + 3*32) + blockhash(32) + ix-count(1)
    //   + ix(programIdx 1 + accIdx 1+2 + data 1+12) = 150 bytes
    expect(msg.length).toBe(150);

    // Header: 1 required sig, 0 readonly-signed, 1 readonly-unsigned.
    expect([...msg.slice(0, 3)]).toEqual([1, 0, 1]);

    // Account keys: compact-u16 count 3, then from, to, System Program (zeros).
    expect(msg[3]).toBe(3);
    expect([...msg.slice(4, 36)]).toEqual([...from]);
    expect([...msg.slice(36, 68)]).toEqual([...to]);
    expect([...msg.slice(68, 100)]).toEqual([...new Uint8Array(32)]);

    // Recent blockhash.
    expect([...msg.slice(100, 132)]).toEqual([...blockhash]);

    // Instruction count, program id index, account indices.
    expect(msg[132]).toBe(1);   // one instruction
    expect(msg[133]).toBe(2);   // program id index → System Program
    expect(msg[134]).toBe(2);   // account index count
    expect([...msg.slice(135, 137)]).toEqual([0, 1]); // from, to

    // Instruction data: length 12, u32 LE selector 2, u64 LE lamports.
    expect(msg[137]).toBe(12);
    const data = msg.slice(138, 150);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    expect(dv.getUint32(0, true)).toBe(2);
    expect(dv.getBigUint64(4, true)).toBe(lamports);
  });
});
