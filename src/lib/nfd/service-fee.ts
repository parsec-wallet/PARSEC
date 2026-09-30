// .algo Names — the registration service fee, paid over x402.
//
// Registering a .algo name is two payments to two parties:
//
//   1. the NFD registry's own price, in ALGO, paid by the mint group itself;
//   2. the registration service fee, in USDC, paid over x402 to the name service
//      (`NAMES_SERVICE_URL`), which records the order against the settlement.
//
// They are different currencies to different recipients, so they are quoted side
// by side and never summed. The fee is quoted BEFORE the participant commits, and
// paid only if the offer at pay time is the one they reviewed — same network, same
// asset, same amount — so a price that moved between review and pay is refused,
// not silently accepted.

import { discoverRequirements, x402Request, type X402PaymentResult } from '../x402/client';
import { ALGORAND_MAINNET, ALGORAND_TESTNET, sameNetwork } from '../x402/networks';
import { quote, type X402Quote } from '../x402/quote';
import type { X402Signers } from '../x402/host';
import type { NetworkId } from '../../types/wallet';

/** The paid registration endpoint. One URL; the network is chosen per payment. */
export const NAMES_SERVICE_URL = 'https://mindx.pythai.net/names/algo';

/** The x402 network matching the wallet's Algorand network. */
export function x402NetworkFor(network: NetworkId): string {
  return network === 'mainnet' ? ALGORAND_MAINNET : ALGORAND_TESTNET;
}

export interface ServiceFeeQuote {
  /** What the participant is shown and agrees to. */
  quote: X402Quote;
  network: string;
}

function orderInit(name: string, owner: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, owner }),
  };
}

/**
 * The service fee for registering `name` to `owner` on `network`, or null when the
 * service asks nothing (not paywalled) — it never returns a fee for another network.
 */
export async function quoteServiceFee(name: string, owner: string, network: NetworkId): Promise<ServiceFeeQuote | null> {
  const want = x402NetworkFor(network);
  const challenge = await discoverRequirements(NAMES_SERVICE_URL, orderInit(name, owner));
  if (!challenge) return null;
  const req = challenge.accepts.find((r) => sameNetwork(r.network, want));
  if (!req) {
    throw new Error(`The name service does not offer payment on ${network}. Offered: ${challenge.accepts.map((r) => r.network).join(', ')}.`);
  }
  return { quote: await quote(req), network: want };
}

export interface ServiceFeeResult {
  txId: string;
  /** The name service's record of the order, when it returned one. */
  reservation: Record<string, unknown> | null;
  result: X402PaymentResult;
}

/**
 * Pay the reviewed service fee.
 *
 * `reviewed` is the quote the participant saw. Approval here is automatic only in
 * the sense that the participant already approved exactly this on the review screen;
 * anything that differs at pay time — network, asset or amount — is refused.
 */
export async function payServiceFee(args: {
  name: string;
  owner: string;
  signers: X402Signers;
  reviewed: ServiceFeeQuote;
}): Promise<ServiceFeeResult> {
  const { reviewed } = args;
  const result = await x402Request(NAMES_SERVICE_URL, orderInit(args.name, args.owner), {
    signers: args.signers,
    preferNetwork: reviewed.network,
    approve: async (pending) => {
      if (pending.preflight && !pending.preflight.ok) {
        throw new Error(`Service fee blocked: ${pending.preflight.blockers.map((b) => b.message).join(' ')}`);
      }
      const r = pending.requirement;
      const same =
        sameNetwork(r.network, reviewed.network) &&
        String(r.asset) === String(reviewed.quote.requirement.asset) &&
        pending.quote.amountAtomic === reviewed.quote.amountAtomic;
      if (!same) {
        throw new Error('The service fee changed after you reviewed it. Go back and review the new price.');
      }
      return true;
    },
  });
  if (!result.success || !result.txId) {
    throw new Error(result.error || 'The service fee did not settle.');
  }
  let reservation: Record<string, unknown> | null = null;
  try {
    const body = result.response ? await result.response.clone().json() : null;
    if (body && typeof body === 'object') reservation = body as Record<string, unknown>;
  } catch { /* the settlement id is the proof; the body is a courtesy */ }
  return { txId: result.txId, reservation, result };
}
