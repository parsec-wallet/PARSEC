// PARSEC Wallet — SMART domain BUY NOW: an ar.io name, permabuy only, at one set.price.
//
// The RAGEbar recognises a name in what is typed and offers it. One price is shown: the protocol's live
// permabuy cost in USD plus the BANKON markup of φ% (0.01618033988749894848 of the cost; the PhiFee.sol
// digits). Buy runs, in order:
//   1. preflight — the name is still free, the account has a Solana key, and that key holds the ARIO;
//   2. the markup, over x402 on whatever rail the wallet settles (mindx.pythai.net/permaweb/markup computes
//      it on the server; PARSEC refuses a figure above its own, with a small allowance for prices moving);
//   3. the permabuy itself, signed by the account's Solana key in the PARSEC Keycore.
// Nothing is custodied: the person's key buys the name from the protocol; BANKON is paid only the markup.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

export const PHI_NUM = 1618033988749894848n;
export const PHI_DEN = 10n ** 20n;
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,49}[a-z0-9])?$/;

/** The ArNS name in what was typed — `thrusttnt`, `thrusttnt.ar.io`, `ar://thrusttnt`, a gateway URL — or null. */
export function smartDomainQuery(raw: string): string | null {
  let v = raw.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^ar:\/\//, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  v = v.replace(/\.ar\.io$/, '').replace(/\.(arweave\.net|permagate\.io|turbo-gateway\.com)$/, '');
  if (v.includes('_') || v.includes('.')) return null; // an extension or another domain, not a name to buy
  return NAME_RE.test(v) && v.length !== 43 ? v : null;
}

/** φ% of the cost, in micro-USD, exact and truncated (never rounded up). Same rule as the server. */
export function markupMicroUsd(costMario: bigint, usdMicroPerArio: bigint): bigint {
  return (costMario * usdMicroPerArio * PHI_NUM) / (10n ** 6n * PHI_DEN);
}

/** The permabuy cost in micro-USD, rounded up (a price shown to a buyer is never low). */
export function costMicroUsd(costMario: bigint, usdMicroPerArio: bigint): bigint {
  return (costMario * usdMicroPerArio + 999_999n) / 1_000_000n;
}

/** The most the markup may be asked at, once quoted: prices move between two reads. */
export function markupCeiling(expectedMicro: bigint): bigint {
  return expectedMicro + expectedMicro / 20n + 1_000n; // +5 % and a tenth of a cent
}

export interface SmartDomainQuote {
  readonly name: string;
  readonly available: boolean;
  readonly reserved?: boolean;
  readonly costMario?: bigint;
  readonly usdMicroPerArio?: bigint | null;
  readonly costMicroUsd?: bigint | null;
  readonly markupMicroUsd?: bigint | null;
  /** The one price shown: cost + markup, in micro-USD (null when the ARIO price is unknown). */
  readonly setPriceMicroUsd?: bigint | null;
}

export interface SmartDomainDeps {
  getRecord(name: string): Promise<unknown | null>;
  isReserved(name: string): Promise<boolean>;
  permabuyCost(name: string): Promise<bigint>;
  /** micro-USD per ARIO, or null when unknown. */
  arioUsdMicro(): Promise<bigint | null>;
}

export async function quoteSmartDomain(name: string, d: SmartDomainDeps): Promise<SmartDomainQuote> {
  const [rec, reserved] = await Promise.all([d.getRecord(name), d.isReserved(name)]);
  if (rec) return { name, available: false };
  if (reserved) return { name, available: false, reserved: true };
  const [costMario, rate] = await Promise.all([d.permabuyCost(name), d.arioUsdMicro()]);
  if (rate === null || rate <= 0n) return { name, available: true, costMario, usdMicroPerArio: null, costMicroUsd: null, markupMicroUsd: null, setPriceMicroUsd: null };
  const cost = costMicroUsd(costMario, rate);
  const markup = markupMicroUsd(costMario, rate);
  return { name, available: true, costMario, usdMicroPerArio: rate, costMicroUsd: cost, markupMicroUsd: markup, setPriceMicroUsd: cost + markup };
}

/** "$26.98" — micro-USD to cents, rounded up (a price is never shown low). */
export function formatUsd(micro: bigint): string {
  const cents = (micro + 9_999n) / 10_000n;
  return `$${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`;
}
