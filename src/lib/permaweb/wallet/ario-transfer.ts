// SPL ARIO on Solana — balance + send via the ar.io SDK's `transfer` (which handles the recipient ATA).

import { getTokenBalance } from '../../solana/token';
import { ARIO_MINT } from '../constants';
import { arioToMario, assertMario, marioToNumber } from '../units';
import { writeArio, sig } from '../client';

export async function getArioBalance(owner: string): Promise<bigint> {
  return (await getTokenBalance(owner, ARIO_MINT)).amount;
}

/** SPL Token program — the ARIO mint is a classic Tokenkeg mint (verified on mainnet). */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * Associated token account for `owner` on the ARIO mint: the PDA of
 * [owner, token program, mint] under the associated-token program.
 *
 * Derived here rather than through `@ar.io/sdk` — the SDK's `getAssociatedTokenAddressKit`
 * is declared in its types but not exported from the package entry point (4.2.0), so importing
 * it throws at runtime.
 */
export async function getArioAta(owner: string): Promise<string> {
  const { getProgramDerivedAddress, getAddressEncoder } = await import('@solana/kit');
  const enc = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM as never,
    seeds: [enc.encode(owner as never), enc.encode(TOKEN_PROGRAM as never), enc.encode(ARIO_MINT as never)],
  });
  return String(ata);
}

export async function sendArio(o: { address: string; passphrase: string; to: string; amountArio: string }): Promise<{ id: string }> {
  const qty = arioToMario(o.amountArio);
  assertMario(qty, 'transfer amount', 0n);
  if (qty <= 0n) throw new Error('amount must be positive');
  const { ario } = await writeArio(o.address, o.passphrase);
  return { id: sig(await (ario as { transfer: (p: { target: string; qty: number }) => Promise<unknown> }).transfer({ target: o.to, qty: marioToNumber(qty) })) };
}
