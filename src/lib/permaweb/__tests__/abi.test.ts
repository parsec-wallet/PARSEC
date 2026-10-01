import { describe, it, expect } from 'vitest';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { encodeBurnCalldata, encodeBalanceOf, decodeUint256, formatDestination, isEvmAddress } from '../bridge/abi';
import { BURN_SELECTOR, BALANCE_OF_SELECTOR } from '../constants';

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
const selector = (sigText: string) => '0x' + hex(keccak_256(new TextEncoder().encode(sigText))).slice(0, 8);
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

describe('bridge abi', () => {
  it('pins the burn(uint256,string) and balanceOf(address) selectors to keccak', () => {
    expect(selector('burn(uint256,string)')).toBe(BURN_SELECTOR);
    expect(selector('balanceOf(address)')).toBe(BALANCE_OF_SELECTOR);
  });
  it('formats the bridge destination', () => {
    expect(formatDestination(SOL)).toBe(`solana:${SOL}`);
    expect(() => formatDestination('0x138746adfA52909E5920def027f5a8dc1C7EfFb6')).toThrow();
    expect(() => formatDestination('not-an-address')).toThrow();
  });
  it('encodes burn calldata with head/tail layout', () => {
    const dest = formatDestination(SOL); // 51 bytes
    const data = encodeBurnCalldata(100_000_000n, dest);
    expect(data.startsWith(BURN_SELECTOR)).toBe(true);
    const body = data.slice(10);
    const words = body.match(/.{64}/g)!;
    expect(BigInt('0x' + words[0])).toBe(100_000_000n);           // amount
    expect(BigInt('0x' + words[1])).toBe(64n);                    // offset to string
    expect(BigInt('0x' + words[2])).toBe(BigInt(dest.length));    // string length (ascii)
    const strHex = words.slice(3).join('');
    expect(strHex.length).toBe(128);                              // 51 bytes padded to 64
    expect(Buffer.from(strHex.slice(0, dest.length * 2), 'hex').toString()).toBe(dest);
    expect(strHex.slice(dest.length * 2)).toMatch(/^0+$/);
  });
  it('rejects zero amounts and non-solana destinations', () => {
    expect(() => encodeBurnCalldata(0n, `solana:${SOL}`)).toThrow();
    expect(() => encodeBurnCalldata(1n, SOL)).toThrow();
  });
  it('encodes balanceOf and decodes uint256', () => {
    const d = encodeBalanceOf('0x10f7Ee226B16bea7f365Dc1eDEF159Fc1957D169');
    expect(d).toBe('0x70a0823100000000000000000000000010f7ee226b16bea7f365dc1edef159fc1957d169');
    expect(decodeUint256('0x000000000000000000000000000000000000000000000000000000175188e08b')).toBe(100_152_172_683n);
    expect(decodeUint256('0x')).toBe(0n);
    expect(isEvmAddress('0x10f7Ee226B16bea7f365Dc1eDEF159Fc1957D169')).toBe(true);
    expect(isEvmAddress('0x10f7')).toBe(false);
  });
});
