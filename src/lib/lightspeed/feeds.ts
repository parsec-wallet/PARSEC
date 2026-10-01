// PARSEC Wallet — Lightspeed feeds
//
// The RpcObservables of light.js, reimplemented on the poll primitive: each
// `x$()` is a stream that polls the participant's chosen provider only while
// somebody subscribes. Names keep the light.js `$` suffix so the lineage is
// legible — `blockNumber$`, `balanceOf$`, `syncStatus$`, `makeContract`.
//
// Everything here is observe-privilege. The write half of light.js
// (`post$`, tutorial 4) is deliberately not implemented: `post$` below exists
// only to show what the privilege ladder does when a module reaches past its
// own declaration.

import { poll, readOnce } from './observable';
import type { Observable, Reading } from './observable';
import { activeProvider } from './registry';
import type { LightspeedProvider, SyncStatus } from './types';
import { assertPrivilege } from '../module-choices';
import { LIGHTSPEED_CHOICES, LIGHTSPEED_ID } from './choices';

/** Poll cadences. A head block every few seconds; balances need not race it. */
export const FREQUENCY = { block: 4_000, sync: 8_000, balance: 12_000, call: 12_000 } as const;

function source(): { origin: string; reach: LightspeedProvider['reach'] } {
  const p = activeProvider();
  return { origin: p.origin, reach: p.reach };
}

function feed<T>(everyMs: number, read: (p: LightspeedProvider) => Promise<T | null>, equals?: (a: T, b: T) => boolean): Observable<Reading<T>> {
  return poll<T>({ source, everyMs, read: () => read(activeProvider()), equals });
}

export function blockNumber$(): Observable<Reading<bigint>> {
  return feed(FREQUENCY.block, (p) => p.blockNumber());
}

export function chainId$(): Observable<Reading<bigint>> {
  return feed(FREQUENCY.block, (p) => p.chainId());
}

export function balanceOf$(address: string): Observable<Reading<bigint>> {
  return feed(FREQUENCY.balance, (p) => p.balanceOf(address));
}

const sameSync = (a: SyncStatus, b: SyncStatus): boolean =>
  a.syncing === b.syncing && a.current === b.current && a.highest === b.highest;

export function syncStatus$(): Observable<Reading<SyncStatus>> {
  return feed(FREQUENCY.sync, (p) => p.syncStatus(), sameSync);
}

/** One-shot head block, for surfaces that render once (dashboard tiles). */
export function readBlockNumber(): Promise<Reading<bigint>> {
  return readOnce<bigint>({ source, read: () => activeProvider().blockNumber() });
}

// ── makeContract — the read half (tutorial 5) ────────────────
// light.js turned an ABI into `method$()` functions. PARSEC carries no ABI
// library, so a contract here is a set of read methods you encode yourself:
// pass the calldata encoder and the return decoder, get a stream.

const WORD_HEX = 64;

function assertEvm(address: string): string {
  const a = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error('invalid EVM address');
  return a.toLowerCase();
}

/** Calldata for a `(address)` selector, e.g. ERC-20 `balanceOf`. */
export function encodeAddressArg(selector: string, address: string): string {
  return selector + assertEvm(address).slice(2).padStart(WORD_HEX, '0');
}

/** Decode a single uint256 return word. `0x` or empty → 0n. */
export function decodeUint256(hex: string): bigint {
  const h = (hex ?? '0x').trim();
  if (h === '0x' || h === '') return 0n;
  if (!/^0x[0-9a-fA-F]+$/.test(h)) throw new Error('invalid hex word');
  return BigInt(h);
}

export const ERC20_BALANCE_OF = '0x70a08231';

export interface ContractRead<A extends unknown[], R> {
  readonly encode: (...args: A) => string;
  readonly decode: (hex: string) => R;
}

export type Contract<M extends Record<string, ContractRead<never[], unknown>>> = {
  readonly address: string;
} & {
  readonly [K in keyof M as `${string & K}$`]: M[K] extends ContractRead<infer A, infer R>
    ? (...args: A) => Observable<Reading<R>>
    : never;
};

export function makeContract<M extends Record<string, ContractRead<never[], unknown>>>(
  address: string,
  methods: M,
): Contract<M> {
  const to = assertEvm(address);
  const out: Record<string, unknown> = { address: to };
  for (const [name, m] of Object.entries(methods)) {
    const method = m as ContractRead<unknown[], unknown>;
    out[`${name}$`] = (...args: unknown[]) => {
      const data = method.encode(...args);
      return feed(FREQUENCY.call, async (p) => {
        const hex = await p.call(to, data);
        return hex === null ? null : method.decode(hex);
      });
    };
  }
  return out as Contract<M>;
}

/** An ERC-20 as light.js's tutorial 5 shows it, reads only. */
export function erc20(address: string) {
  return makeContract(address, {
    balanceOf: {
      encode: (holder: string) => encodeAddressArg(ERC20_BALANCE_OF, holder),
      decode: decodeUint256,
    },
  });
}

// ── post$ — the boundary, stated ─────────────────────────────

/**
 * light.js's `post$` signs and broadcasts. Lightspeed declared `observe`, so
 * this throws a PrivilegeError before touching anything — the template for
 * what a module must do before it signs: raise its declaration to `sign`,
 * then route the signature through the PARSEC Keycore, never a key in JS.
 */
export function post$(): never {
  assertPrivilege(LIGHTSPEED_ID, LIGHTSPEED_CHOICES, 'sign');
  throw new Error('unreachable: observe-only module passed a sign check');
}
