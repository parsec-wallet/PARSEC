// Parsec Wallet — Core Types

export type NetworkId = 'mainnet' | 'testnet' | 'betanet';

export interface WalletAccount {
  address: string;
  name: string;
  createdAt: number;
  watchOnly?: boolean;
}

export interface AccountInfo {
  address: string;
  amount: number;
  minBalance: number;
  assets: AssetHolding[];
  pendingRewards: number;
  round: number;
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
  | 'docs'
  | 'settings'
  | 'pmvpn'
  | 'x402-confirm'
  | 'agents'
  | 'identity'
  | 'connect-approve'
  | 'admin-keygen'
  | 'mausoleum';

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
