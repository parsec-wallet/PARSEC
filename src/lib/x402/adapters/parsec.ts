// PARSEC's implementations of the x402 host ports.
//
// The only file in the module that knows PARSEC exists. Everything else talks to
// `host.ts`, which is why the same protocol code runs in another wallet unchanged.
//
// Both signers route through Rust: `chain_algo_sign_transaction` takes the exact
// `TX`-prefixed preimage from `bytesToSign()`, `chain_evm_sign_transfer_authorization`
// builds the EIP-712 digest itself from named fields. A key is never returned to the
// renderer in either case.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { setX402Transport } from '../host';
import { invoke, isTauri } from '../../platform';
import type algosdk from 'algosdk';
import { algoSignTransaction } from '../../chain-algo';
import { evmSignTransferAuthorization } from '../../chain-evm';
import { solSign } from '../../chain-sol';
import { getAccountAddress } from '../../store';
import type { WalletAccount } from '../../../types/wallet';
import { base64ToBytes, bytesToBase64 } from '../protocol';
import { configureX402Host, type AvmSigner, type EvmSigner, type SvmSigner, type X402Signers } from '../host';
import { getAlgodClient } from '../../algorand/client';
import { PriceOracle } from '../oracle';
// `describeNetwork`, not `rails/avm`'s `walletNetworkFor`: importing the rail module
// registers the rail as a side effect, which would silently replace a test's stub.
import { describeNetwork } from '../networks';

/**
 * An Algorand signer backed by the vault and Rust.
 *
 * Signs one transaction at a time because that is what the IPC surface offers; the
 * group is still atomic on chain, since grouping happens before any of this.
 */
export function parsecAvmSigner(address: string): AvmSigner {
  const sign: algosdk.TransactionSigner = async (txnGroup, indexesToSign) => {
    const out: Uint8Array[] = [];
    for (const i of indexesToSign) {
      const txn = txnGroup[i];
      if (txn.sender.toString() !== address) {
        throw new Error(`asked to sign transaction ${i}, which is not from ${address}`);
      }
      const { signature_b64 } = await algoSignTransaction(address, bytesToBase64(txn.bytesToSign()));
      out.push(txn.attachSignature(address, base64ToBytes(signature_b64)));
    }
    return out;
  };
  return { address, sign };
}

/** An EVM signer backed by the vault and Rust. */
export function parsecEvmSigner(address: string): EvmSigner {
  return {
    address,
    async signTransferAuthorization(domain, authorization) {
      const { signature_hex } = await evmSignTransferAuthorization(
        address,
        {
          name: domain.name,
          version: domain.version,
          chain_id: domain.chainId,
          verifying_contract: domain.verifyingContract,
        },
        {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value,
          valid_after: authorization.validAfter,
          valid_before: authorization.validBefore,
          nonce: authorization.nonce,
        },
      );
      return signature_hex;
    },
  };
}

/**
 * A Solana signer backed by the vault and Rust.
 *
 * `chain_sol_sign` signs the bytes it is handed with no added prefix, which is what a
 * compiled Solana message needs — the message is already the thing signed, and a domain
 * tag would make the signature invalid.
 */
export function parsecSvmSigner(address: string): SvmSigner {
  return {
    address,
    async signTransaction(message) {
      const { signature_b64 } = await solSign(address, bytesToBase64(message));
      return base64ToBytes(signature_b64);
    },
  };
}

/** The wallet's chain id per rail family. */
const CHAIN_ID_FOR: Record<string, string> = { avm: 'algorand', evm: 'ethereum', svm: 'solana', arweave: 'arweave' };

/**
 * The addresses this account can pay from, one per rail family.
 *
 * For the read-only paths — quoting, preflight, a probe — where nothing is signed and a
 * full signer is more than the caller needs.
 */
export function payersFromAccount(account: WalletAccount): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [family, chainId] of Object.entries(CHAIN_ID_FOR)) {
    const address = getAccountAddress(account, chainId);
    if (address) out[family] = address;
  }
  return out;
}

/**
 * Every signer this account can offer.
 *
 * Which one pays is decided by the offer the server makes, so the flow is handed all of
 * them rather than being told one address up front and discovering it belonged to the
 * wrong chain.
 */
export function signersForAccount(account: WalletAccount): X402Signers {
  const signers: X402Signers = {};
  const algorand = getAccountAddress(account, 'algorand');
  if (algorand) signers.avm = parsecAvmSigner(algorand);
  const ethereum = getAccountAddress(account, 'ethereum');
  if (ethereum) signers.evm = parsecEvmSigner(ethereum);
  const solana = getAccountAddress(account, 'solana');
  if (solana) signers.svm = parsecSvmSigner(solana);
  return signers;
}


// ── PARSEC as a host ─────────────────────────────────────────────────────────

const oracle = new PriceOracle();

/**
 * Register PARSEC's facilities against the module's ports.
 *
 * Called once, from the module manifest. Everything the module needs from the
 * application it gets here and nowhere else — which is why the same code runs
 * unchanged in a wallet that is not this one.
 *
 * Only `algod` and `usdRate` are supplied: `localStorage` is already the default,
 * and the public EVM endpoints are fine until an operator says otherwise.
 */
export function configureParsecX402Host(): void {
  configureX402Host({
    // PARSEC's own algod configuration, so a payment and a balance read use the same node.
    algod: (network) => getAlgodClient(describeNetwork(network).walletNetwork ?? 'testnet'),

    // The Vestige DEX feed, for display beside a quote. Returning null — which it does
    // on any failure — means the quote is shown in the asset it is denominated in,
    // which is never wrong, only less convenient.
    usdRate: async (symbol) => {
      if (symbol.toUpperCase() !== 'ALGO') return null;
      // Measured or nothing: a fixed fallback here would price payments against the
      // auto-approve cap with a guess.
      const usd = await oracle.getAlgoUsdLive();
      return usd !== null && usd > 0 ? usd : null;
    },
  });
}

// ── Transport: x402 requests leave through Rust on desktop ────────
//
// A seller's CORS policy will not list PARSEC's webview origin, and a packaged
// build's CSP allows only a fixed host list, so from the webview most x402
// sellers are unreachable. On desktop every x402 request goes through the
// `http_request` command (src-tauri/src/parsec_http: https only, GET/POST/HEAD,
// no cookies, size and time bounded). The browser build keeps `fetch`.

function headerPairs(h: HeadersInit | undefined): [string, string][] {
  if (!h) return [];
  if (h instanceof Headers) return [...h.entries()];
  if (Array.isArray(h)) return h.map(([k, v]) => [k, v]);
  return Object.entries(h);
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

export async function parsecTransport(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isTauri || (init.body !== undefined && init.body !== null && typeof init.body !== 'string')) {
    return globalThis.fetch(url, init);
  }
  const r = await invoke<{ status: number; headers: [string, string][]; body_b64: string; url: string }>('http_request', {
    request: {
      method: (init.method ?? 'GET').toUpperCase(),
      url,
      headers: headerPairs(init.headers),
      body: typeof init.body === 'string' ? init.body : null,
    },
  });
  const bytes = Uint8Array.from(atob(r.body_b64), (c) => c.charCodeAt(0));
  const headers = new Headers();
  for (const [k, v] of r.headers) { try { headers.append(k, v); } catch { /* a header Response may not carry */ } }
  return new Response(NULL_BODY.has(r.status) ? null : bytes, { status: r.status, headers });
}

if (isTauri) setX402Transport(parsecTransport);
