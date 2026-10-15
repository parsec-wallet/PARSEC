// PARSEC Wallet — SMART domain BUY NOW: paying the BANKON markup over x402. Kept apart from
// smart-domain.ts so the RAGEbar (an eager view) never pulls the x402 client in.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { x402Request } from '../x402/client';
import type { X402Signers } from '../x402/host';
import { formatUsd, markupCeiling } from './smart-domain';

export const MARKUP_URL = 'https://mindx.pythai.net/permaweb/markup';

/** Pay the markup over x402. The server computes it; PARSEC refuses one above its own figure. */
export async function payMarkup(name: string, signers: X402Signers, expectedMicro: bigint): Promise<{ txId: string; paidMicro: bigint }> {
  const ceiling = markupCeiling(expectedMicro);
  let paid = 0n;
  const result = await x402Request(MARKUP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }, {
    signers,
    approve: async () => true,
    verify: (pending) => {
      if (pending.quote.usdMicro === null) throw new Error('The markup was not offered in a dollar stablecoin. Nothing was paid.');
      if (pending.quote.usdMicro > ceiling) {
        throw new Error(`The markup asked (${formatUsd(pending.quote.usdMicro)}) is more than PARSEC computed (${formatUsd(expectedMicro)}). Nothing was paid.`);
      }
      paid = pending.quote.usdMicro;
    },
  });
  if (!result.success || !result.txId) throw new Error(result.error || 'The markup payment did not settle.');
  return { txId: result.txId, paidMicro: paid };
}
