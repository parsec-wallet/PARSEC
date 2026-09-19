import { describe, it, expect } from 'vitest';
import algosdk from 'algosdk';

import {
  RENEW_METHOD,
  GET_RENEW_PRICE_METHOD,
  MAX_RENEW_YEARS,
  renewPaymentAmount,
} from '../renew';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

describe('NFD renew — ABI methods', () => {
  it('renew has the exact contract signature and selector', () => {
    // A wrong signature silently targets a different selector and fails
    // on-chain. Pin both the signature and the 4-byte selector.
    expect(RENEW_METHOD.getSignature()).toBe('renew(pay)void');
    expect(hex(RENEW_METHOD.getSelector())).toBe(
      hex(algosdk.ABIMethod.fromSignature('renew(pay)void').getSelector()),
    );
  });

  it('renew takes exactly one payment-transaction argument', () => {
    expect(RENEW_METHOD.args).toHaveLength(1);
    expect(RENEW_METHOD.args[0].type).toBe('pay');
    expect(algosdk.abiTypeIsTransaction(RENEW_METHOD.args[0].type)).toBe(true);
    expect(RENEW_METHOD.txnCount()).toBe(2); // payment + app call
  });

  it('getRenewPrice is a readonly uint64 getter with a pinned selector', () => {
    expect(GET_RENEW_PRICE_METHOD.getSignature()).toBe('getRenewPrice()uint64');
    expect(GET_RENEW_PRICE_METHOD.args).toHaveLength(0);
    expect(GET_RENEW_PRICE_METHOD.returns.type.toString()).toBe('uint64');
    expect(hex(GET_RENEW_PRICE_METHOD.getSelector())).toBe(
      hex(algosdk.ABIMethod.fromSignature('getRenewPrice()uint64').getSelector()),
    );
  });
});

describe('NFD renew — payment math', () => {
  // The contract adds 365 × (paid ÷ renewPrice) days, so N years is a single
  // payment of N × price — no per-year loop.
  it('multiplies the per-year price by whole years', () => {
    expect(renewPaymentAmount(5_000_000n, 1)).toBe(5_000_000n);
    expect(renewPaymentAmount(5_000_000n, 3)).toBe(15_000_000n);
    expect(renewPaymentAmount(1n, MAX_RENEW_YEARS)).toBe(20n);
  });

  it('caps at NFD_MAX_EXPIRATION_DAYS (20 years)', () => {
    expect(MAX_RENEW_YEARS).toBe(20);
    expect(() => renewPaymentAmount(5_000_000n, 21)).toThrow(/1–20/);
  });

  it('rejects zero, negative, and fractional years', () => {
    expect(() => renewPaymentAmount(5_000_000n, 0)).toThrow();
    expect(() => renewPaymentAmount(5_000_000n, -1)).toThrow();
    expect(() => renewPaymentAmount(5_000_000n, 1.5)).toThrow();
    expect(() => renewPaymentAmount(5_000_000n, Number.NaN)).toThrow();
  });

  it('rejects an unavailable (zero) price', () => {
    expect(() => renewPaymentAmount(0n, 1)).toThrow(/unavailable/);
  });
});
