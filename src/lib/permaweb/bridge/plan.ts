// Bridge planner — pure. Splits a migration into a small test tranche followed by the remainder, and
// validates against the service's minimum and the source balance.

export interface BridgePlanInput {
  balanceRaw: bigint;
  amountRaw: bigint;
  minAmountRaw: bigint;
  /** 0n disables the test tranche. */
  testTrancheRaw?: bigint;
  bridgeClosing?: boolean;
}

export interface BridgePlan {
  errors: string[];
  warnings: string[];
  tranches: bigint[];
}

export const DEFAULT_TEST_TRANCHE_RAW = 100n * 1_000_000n; // 100 ARIO

export function planBridge(i: BridgePlanInput): BridgePlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (i.amountRaw <= 0n) errors.push('Amount must be positive');
  if (i.amountRaw > i.balanceRaw) errors.push('Amount exceeds the Base ARIO balance');
  if (i.amountRaw < i.minAmountRaw) errors.push(`Amount is below the bridge minimum (${i.minAmountRaw} raw)`);
  if (i.bridgeClosing) warnings.push('ar.io says the Base→Solana bridge is closing — migrate now, test tranche first');

  const test = i.testTrancheRaw ?? DEFAULT_TEST_TRANCHE_RAW;
  const tranches: bigint[] = [];
  if (errors.length === 0) {
    if (test > 0n && i.amountRaw > test && i.amountRaw - test >= i.minAmountRaw) {
      tranches.push(test, i.amountRaw - test);
    } else {
      tranches.push(i.amountRaw);
    }
  }
  return { errors, warnings, tranches };
}
