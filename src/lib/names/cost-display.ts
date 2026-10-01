// PARSEC Wallet — a name's price, as a person should read it.
//
// Registries quote ARIO in mARIO (10^-6 ARIO). Shown raw, 3504218340 reads as three
// billion ARIO; it is 3,504.21834. This formats exactly (integer arithmetic, no float) and
// adds the dollar value when the ARIO price is known, rounded up so it is never shown low.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { formatArio } from '../arweave/ario';
import { fetchPricesByIds } from '../prices';
import { usdRateMicro } from '../permaweb/storage-cost';

let arioUsdMicro: bigint | null = null;

/** Read the ARIO price once for the screens that show name costs. Never throws. */
export async function warmArioPrice(): Promise<void> {
  try {
    const c = await fetchPricesByIds(['ar-io-network']);
    arioUsdMicro = usdRateMicro(c.find((x) => x.id === 'ar-io-network')?.usd);
  } catch { /* costs show in ARIO alone */ }
}

/** "1234567.5" → "1,234,567.5", on the digits as they are. */
export function groupThousands(decimal: string): string {
  const [w, f] = decimal.split('.');
  return w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
}

/** mARIO at a USD rate (micro-USD per ARIO) → micro-USD, rounded up. */
export function marioToUsdMicro(mario: bigint, rateMicro: bigint): bigint {
  return (mario * rateMicro + 999_999n) / 1_000_000n;
}

function usd(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const cents = ((micro % 1_000_000n) + 9_999n) / 10_000n; // up to the cent
  return cents >= 100n ? `$${groupThousands(String(whole + 1n))}.00` : `$${groupThousands(String(whole))}.${cents.toString().padStart(2, '0')}`;
}

/** A cost in a registry's unit, readable: ARIO formatted exactly with its USD value. */
export function formatNameCost(amount: bigint, unit: string, rateMicro: bigint | null = arioUsdMicro): string {
  if (unit !== 'ARIO') return `${amount.toString()} ${unit}`;
  const ario = `${groupThousands(formatArio(amount))} ARIO`;
  return rateMicro !== null ? `${ario} (≈ ${usd(marioToUsdMicro(amount, rateMicro))})` : ario;
}
