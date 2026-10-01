// permaweb module — constants. Every number here was verified against docs.ar.io / the live chain on
// 2026-08-27; the older local docs (10,000 ARIO minimum, `qty` param, Arweave-address AR_IO_WALLET)
// are stale. See docs/permaweb/README.md and docs/reference/permaweb/.

export { ARIO_MINT } from '../solana/token';

/** ar.io Solana mainnet programs (docs.ar.io/learn/token — byte-identical to @ar.io/sdk constants).
 *  `ant` re-confirmed 2026-09-02 against a live third-party name: https://toon.ar.io/ resolves with
 *  `x-arns-ant-program-id: 2MWexMHfMhGJwMHv9Qm9YAVCqjUFUJwDJAysW4oCUGk5`.
 *  See docs/reference/permaweb/toon-ar-io/. */
export const ARIO_PROGRAMS = {
  core: '73YoECm6NKXpVRoe5f1Q9BcP5DJGPFUjnFy6AxBE5Nvh',
  gar: '89fNiiwgpFSPHKuqfNUkgYTYjtAJAhyqHjXmgXeppGpf',
  arns: '2yCUx5edFvUrkibYaUa2ZXWyx9kuJkS8CwyzsgHPWdZZ',
  ant: '2MWexMHfMhGJwMHv9Qm9YAVCqjUFUJwDJAysW4oCUGk5',
  antEscrow: '5HZhe9UqKL5zAsdz81nuuaxV41h8bFhudzxxBigAQndM',
} as const;

// ── Gateway registry economics (docs.ar.io/learn/oip/staking, Solana era) ──────────────────────
export const MIN_OPERATOR_STAKE_ARIO = 20_000n;
export const MIN_DELEGATE_STAKE_ARIO = 10n;
export const REGISTRY_CAP = 3000;
export const MAX_REWARD_SHARE = 95;
export const DELEGATE_WITHDRAWAL_DAYS = 30;
export const PRUNE_FAILED_EPOCHS = 30;
/** ar-io-node release the Solana-era join preflight requires (r82 is current). */
export const MIN_NODE_RELEASE = 82;
/** SOL the operator should hold before any GAR write (each write is < 0.01 SOL). */
export const MIN_OPERATOR_SOL = 0.05;
/** SOL an observer/upload wallet should carry for several months of reports. */
export const RECOMMENDED_NODE_WALLET_SOL = 0.5;

// ── Base → Solana bridge (verified 2026-08-28: swap.ar.io bundle + bridge.services.ar.io/v1/info) ──
export const BASE_CHAIN_ID = 8453;
export const BASE_CHAIN_ID_HEX = '0x2105';
export const BASE_RPC = 'https://mainnet.base.org';
export const BASE_ARIO = '0x138746adfA52909E5920def027f5a8dc1C7EfFb6';
/** keccak256("burn(uint256,string)")[0..4] — the Base ARIO token's bridge entry point. */
export const BURN_SELECTOR = '0x7641e6f3';
export const BALANCE_OF_SELECTOR = '0x70a08231';
export const BRIDGE_SERVICE = 'https://bridge.services.ar.io';
export const BRIDGE_CONFIRMATIONS = 3;
export const SWAP_URL = 'https://swap.ar.io';
export const SOL_AR_IO_URL = 'https://sol.ar.io';

// ── External surfaces ──────────────────────────────────────────────────────────────────────────
export const GATEWAYS_DASHBOARD = 'https://gateways.ar.io/#/';
export const SOLANA_EXPLORER_TX = 'https://explorer.solana.com/tx/';
export const BASESCAN_TX = 'https://basescan.org/tx/';
