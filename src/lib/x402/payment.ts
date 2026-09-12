// Parsec x402 Integration — Payment Flow
// Handles 402 responses: parse requirement → check discount → build signer → pay → settle.
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { buildAlgorandX402Signer } from './bridge';
import { PriceOracle } from './oracle';
import { checkBankonHolder, applyDiscountExact } from './discount';
import { ALGO_DECIMALS, USD_DECIMALS, formatDecimal, parseDecimal, usdToAssetUnits } from '../money';
import { BANKON_ASA_ID, DEFAULT_DISCOUNT_PCT } from './constants';
import type { BankonPaymentRequirement } from './types';
import type { NetworkId } from '../../types/wallet';

// ── Payment State ────────────────────────────────────────────────

export interface PendingX402Payment {
  /** Original request URL */
  url: string;
  /** Original request options */
  requestInit?: RequestInit;
  /** Parsed 402 response */
  requirement: BankonPaymentRequirement;
  // ── Exact amounts (cypherpunk4096 commitment IV) ──
  // These are the truth. Scaled bigints, no float anywhere in their
  // derivation, and `amountMicroAlgos` is precisely what gets signed.

  /** List price, scaled micro-USD. */
  priceUsdExact: bigint;
  /** Price after the holder discount, scaled micro-USD. */
  effectivePriceUsdExact: bigint;
  /** The amount actually charged, in microALGO. This is what is signed. */
  amountMicroAlgos: bigint;
  /** ALGO/USD rate used, scaled micro-USD. */
  exchangeRateExact: bigint;

  // ── Display strings, derived from the exact values above ──
  /** Price in USD, formatted. */
  priceUsdDisplay: string;
  /** Effective price in USD, formatted. */
  effectivePriceUsdDisplay: string;
  /** Effective price in ALGO, formatted. */
  effectivePriceAlgoDisplay: string;

  /** Whether payer holds BANKON for discount */
  isHolder: boolean;
  /** BANKON balance */
  bankonBalance: number;
  /** Endpoint description (from price table or path) */
  description: string;
}

export interface X402PaymentResult {
  success: boolean;
  txId?: string;
  response?: Response;
  error?: string;
}

// ── Singleton oracle for the payment module ──────────────────────

const oracle = new PriceOracle();

// ── Payment Flow Functions ───────────────────────────────────────

/**
 * Parse a 402 response into a PendingX402Payment with price conversion + discount check.
 */
export async function parsePaymentRequirement(
  url: string,
  responseBody: unknown,
  payerAddress: string,
  requestInit?: RequestInit,
): Promise<PendingX402Payment> {
  const req = responseBody as BankonPaymentRequirement;
  // Exact from the wire: the quoted price is parsed as a decimal string, never
  // through parseFloat, which would approximate it before we ever charge it.
  const priceUsdExact = parseDecimal(req.price, USD_DECIMALS);

  // Fetch current ALGO/USD and check BANKON holder status in parallel
  const [algoUsd, holderStatus] = await Promise.all([
    oracle.getAlgoUsd(),
    checkBankonHolder(payerAddress, BANKON_ASA_ID),
  ]);

  const exchangeRateExact = parseDecimal(algoUsd.toFixed(USD_DECIMALS), USD_DECIMALS);
  const effectivePriceUsdExact = applyDiscountExact(
    priceUsdExact,
    holderStatus.isHolder,
    DEFAULT_DISCOUNT_PCT,
  );
  // Round UP: the payer covers the remainder rather than underpaying and
  // having the payment rejected.
  const amountMicroAlgos = usdToAssetUnits(
    effectivePriceUsdExact,
    USD_DECIMALS,
    exchangeRateExact,
    USD_DECIMALS,
    ALGO_DECIMALS,
    'ceil',
  );

  // Extract endpoint description from path
  const urlObj = new URL(url);
  const description = ENDPOINT_DESCRIPTIONS[urlObj.pathname] || urlObj.pathname;

  return {
    url,
    requestInit,
    requirement: req,
    priceUsdExact,
    effectivePriceUsdExact,
    amountMicroAlgos,
    exchangeRateExact,
    priceUsdDisplay: formatDecimal(priceUsdExact, USD_DECIMALS, { maxFractionDigits: 4, trim: false }),
    effectivePriceUsdDisplay: formatDecimal(effectivePriceUsdExact, USD_DECIMALS, { maxFractionDigits: 4, trim: false }),
    effectivePriceAlgoDisplay: formatDecimal(amountMicroAlgos, ALGO_DECIMALS, { trim: false }),
    isHolder: holderStatus.isHolder,
    bankonBalance: holderStatus.balance,
    description,
  };
}

/**
 * Execute an x402 payment: build signer → sign tx → re-request with X-PAYMENT header.
 */
export async function executeX402Payment(
  pending: PendingX402Payment,
  payerAddress: string,
  passphrase: string,
  network: NetworkId = 'testnet',
): Promise<X402PaymentResult> {
  try {
    // Build vault-secured signer (ephemeral key retrieval)
    const signer = await buildAlgorandX402Signer(payerAddress, passphrase, network);

    // Build payment transaction
    const algosdk = await import('algosdk');
    const client = signer.getAlgodClient();
    const suggestedParams = await client.getTransactionParams().do();

    // Already exact — computed once at quote time and carried, not recomputed
    // from a rounded display value. algosdk takes a number or bigint here.
    const amountMicroAlgos = pending.amountMicroAlgos;
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: payerAddress,
      receiver: pending.requirement.payTo,
      amount: amountMicroAlgos,
      note: new TextEncoder().encode(`x402:${new URL(pending.url).pathname}`),
      suggestedParams,
    });

    // Sign with vault-secured key
    const signedTxnBytes = await signer.signTransaction(txn.toByte());

    // Encode signed tx as base64 for X-PAYMENT header
    const paymentHeader = btoa(String.fromCharCode(...signedTxnBytes));

    // Re-send original request with payment header
    const response = await fetch(pending.url, {
      ...pending.requestInit,
      headers: {
        ...(pending.requestInit?.headers || {}),
        'X-PAYMENT': paymentHeader,
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      return { success: true, response };
    }

    return {
      success: false,
      error: `Payment accepted but resource returned ${response.status}`,
      response,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Wrapper for fetch that automatically handles x402 payment flows.
 * Returns a Promise that resolves after payment approval + execution.
 * The onPaymentRequired callback lets the UI show a confirmation dialog.
 */
export async function x402Fetch(
  url: string,
  init: RequestInit | undefined,
  payerAddress: string,
  passphrase: string,
  network: NetworkId,
  onPaymentRequired: (pending: PendingX402Payment) => Promise<boolean>,
): Promise<Response> {
  // Initial request
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.headers || {}), Accept: 'application/json' },
  });

  // Not a 402 — return as-is
  if (response.status !== 402) return response;

  // Parse 402 requirement
  const body = await response.json();
  const pending = await parsePaymentRequirement(url, body, payerAddress, init);

  // Ask UI for approval
  const approved = await onPaymentRequired(pending);
  if (!approved) {
    throw new Error('Payment declined by user');
  }

  // Execute payment
  const result = await executeX402Payment(pending, payerAddress, passphrase, network);
  if (!result.success || !result.response) {
    throw new Error(result.error || 'Payment failed');
  }

  return result.response;
}

// ── Endpoint Descriptions ────────────────────────────────────────

const ENDPOINT_DESCRIPTIONS: Record<string, string> = {
  '/weather': 'NASA satellite weather data',
  '/climate/glaciers': 'GLACIERS climate oracle',
  '/oracle/feed': 'Multi-asset DEX price feed',
  '/mint/asa': 'Mint Algorand Standard Asset',
  '/mint/batch': 'Batch mint 20 ASAs',
  '/mint/agent': 'Register ERC-8004 Agent IDNFT',
  '/mint/token': 'Deploy ERC-20 token',
  '/mint/bonafide': 'Deploy BONAFIDE reputation suite',
};
