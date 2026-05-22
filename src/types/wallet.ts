// Parsec Wallet — Core Types

import type { ChainId } from '../lib/pouch/types';

export type NetworkId = 'mainnet' | 'testnet' | 'betanet';

// One human identity = one WalletAccount with addresses on many chains.
// `address` stays as the primary Algorand address for back-compat with all
// existing read sites. `chains` is the authoritative per-chain mapping.
export interface WalletAccount {
  address: string;
  name: string;
  createdAt: number;
  watchOnly?: boolean;
  /** Per-chain address map. The store normalizes this on every set(); callers
   * that mint fresh accounts can omit it and let the store backfill. */
  chains?: Record<string, string>;
  activeChain?: ChainId;
  /** Emoji avatar (Phantom-style personalization). The store backfills a
   * deterministic default when absent — see lib/avatars.ts. */
  avatar?: string;
}

export interface AccountInfo {
  address: string;
  amount: number;
  minBalance: number;
  assets: AssetHolding[];
  pendingRewards: number;
  round: number;
}

export interface NftMeta {
  name?: string;
  description?: string;
  image?: string;
  mimeType?: string;
  traits: Record<string, string | number>;
  arcVariant: 'arc-3' | 'arc-19' | 'arc-69' | 'unknown';
}

export interface AssetHolding {
  assetId: number;
  amount: number;
  isFrozen: boolean;
  name?: string;
  unitName?: string;
  decimals?: number;
  hasFreezeAddr?: boolean;
  hasClawbackAddr?: boolean;
  nft?: NftMeta;
}

export interface TransactionRecord {
  id: string;
  type: 'pay' | 'axfer' | 'appl' | 'acfg' | 'afrz' | 'keyreg';
  sender: string;
  receiver?: string;
  amount: number;
  fee: number;
  note?: string;
  assetId?: number;
  appId?: number;
  createdAssetId?: number;
  createdAppId?: number;
  confirmedRound?: number;
  roundTime?: number;
  group?: string;
}

export interface WalletSettings {
  network: NetworkId;
  autoLockMinutes: number;
  showTestnetWarning: boolean;
  /** Opt-in Diagnostics screen. Undefined / false = off (the default). */
  enableDiagnostics?: boolean;
}

// Pending send — held in memory only for confirm-send flow
export interface PendingSend {
  receiver: string;
  amount: number;
  assetId: number | null; // null = ALGO
  assetUnitName: string;
  assetDecimals: number;
  note: string;
  fee: number; // microAlgos
}

export type AppView =
  | 'matrix'
  | 'onboarding'
  | 'create-wallet'
  | 'verify-mnemonic'
  | 'import-wallet'
  | 'unlock'
  | 'dashboard'
  | 'send'
  | 'confirm-send'
  | 'receive'
  | 'add-asset'
  | 'swap'
  | 'onramp'
  | 'nfdominter'
  | 'nfdominter-confirm'
  | 'nfdominter-buy'
  | 'diagnostics'
  | 'docs'
  | 'settings'
  | 'pmvpn'
  | 'x402-confirm'
  | 'agents'
  | 'identity'
  | 'connect-approve'
  | 'admin-keygen'
  | 'mausoleum'
  | 'xchain-connect'
  | 'arc52-create'
  | 'arweave-approve'
  | 'arweave-ario-migrate'
  | 'solana-create'
  | 'solana-send'
  | 'ario-migrate-solana'
  | 'arweave-create'
  | 'arweave-send'
  | 'ario-claim-pythai'
  | 'bankon-hub'
  | 'bankon-claim'
  | 'bankon-name'
  | 'bankon-resolve'
  | 'bankon-admin'
  | 'ario-hub'
  | 'ario-claim'
  | 'ario-name'
  | 'ario-transfer'
  | 'ario-resolve'
  | 'name-mint'
  | 'name-hub'
  | 'name-claim'
  | 'name-manage'
  | 'name-resolve'
  | 'market-hub'
  | 'market-listing'
  | 'market-create'
  | 'market-auction';

export interface WalletState {
  view: AppView;
  accounts: WalletAccount[];
  activeAccountIndex: number;
  accountInfo: AccountInfo | null;
  transactions: TransactionRecord[];
  settings: WalletSettings;
  isLoading: boolean;
  error: string | null;
}
