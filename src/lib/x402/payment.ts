// Parsec x402 Integration — Payment Flow
// Handles 402 responses: parse requirement → check discount → build signer → pay → settle.
// (c) 2026 BANKON — GPL-3.0

import { buildAlgorandX402Signer } from './bridge';
import { PriceOracle } from './oracle';
import { checkBankonHolder, applyDiscount } from './discount';
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
  /** Price in USD */
  priceUsd: number;
  /** Price in ALGO */
  priceAlgo: number;
  /** ALGO/USD exchange rate used */
  exchangeRate: number;
  /** Whether payer holds BANKON for discount */
  isHolder: boolean;
  /** BANKON balance */
  bankonBalance: number;
  /** Effective price after discount */
  effectivePriceUsd: number;
  /** Effective price in ALGO */
  effectivePriceAlgo: number;
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
  const priceUsd = parseFloat(req.price);

  // Fetch current ALGO/USD and check BANKON holder status in parallel
  const [algoUsd, holderStatus] = await Promise.all([
    oracle.getAlgoUsd(),
    checkBankonHolder(payerAddress, BANKON_ASA_ID),
  ]);

  const priceAlgo = +(priceUsd / algoUsd).toFixed(6);
  const effectivePriceUsd = applyDiscount(priceUsd, holderStatus.isHolder, DEFAULT_DISCOUNT_PCT);
  const effectivePriceAlgo = +(effectivePriceUsd / algoUsd).toFixed(6);

  // Extract endpoint description from path
  const urlObj = new URL(url);
  const description = ENDPOINT_DESCRIPTIONS[urlObj.pathname] || urlObj.pathname;

  return {
    url,
    requestInit,
    requirement: req,
    priceUsd,
    priceAlgo,
    exchangeRate: algoUsd,
    isHolder: holderStatus.isHolder,
    bankonBalance: holderStatus.balance,
    effectivePriceUsd,
    effectivePriceAlgo,
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

    const amountMicroAlgos = Math.ceil(pending.effectivePriceAlgo * 1e6);
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
