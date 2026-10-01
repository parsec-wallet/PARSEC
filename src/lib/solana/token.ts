// SPL token reads — the ARIO (canonical Solana) balance surface for the migration view and the
// solana-arns namespace adapter. Same PublicNode RPC + privacy caveat as balance.ts.

import { solanaRpc } from './balance';

/** Canonical AR.IO Network token mint on Solana (6 decimals). */
export const ARIO_MINT = 'DcNnMuFxwhgV4WY1HVSaSEgr92bv2b1vUvEKiNxWqHdF';

export interface TokenBalance {
  /** Raw amount in the mint's base units. */
  amount: bigint;
  decimals: number;
  /** Human string, e.g. "100152.172683". */
  uiAmountString: string;
}

interface ParsedTokenAccount {
  account: {
    data: {
      parsed: { info: { tokenAmount: { amount: string; decimals: number; uiAmountString: string } } };
    };
  };
}

/** Sum of all token accounts `owner` holds for `mint`. Zero-account → 0n. */
export async function getTokenBalance(owner: string, mint: string = ARIO_MINT): Promise<TokenBalance> {
  const res = await solanaRpc<{ value: ParsedTokenAccount[] }>('getTokenAccountsByOwner', [
    owner,
    { mint },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);
  let amount = 0n;
  let decimals = 6;
  for (const acc of res?.value ?? []) {
    const ta = acc.account?.data?.parsed?.info?.tokenAmount;
    if (!ta) continue;
    amount += BigInt(ta.amount);
    decimals = ta.decimals;
  }
  const div = 10n ** BigInt(decimals);
  const uiAmountString = `${amount / div}.${(amount % div).toString().padStart(decimals, '0')}`;
  return { amount, decimals, uiAmountString };
}
