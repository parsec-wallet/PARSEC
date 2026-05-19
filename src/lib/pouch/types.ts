// Parsec Wallet Pouch — Core Types
// Wallet Module → Pouch → Vault Identity
// Cypherpunk2048 Standard

// ── Chain Module Interface ────────────────────────────────────

export type ChainFamily = 'algorand' | 'evm' | 'utxo' | 'cryptonote' | 'zilliqa' | 'cardano' | 'arweave';
export type ChainId = 'bitcoin' | 'ethereum' | 'algorand' | 'algorand-xchain' | 'algorand-hd' | 'solana' | 'litecoin' | 'monero' | 'zilliqa' | 'cardano' | 'arweave' | 'arweave-hd' | string;

export interface WalletModule {
  chainId: ChainId;
  name: string;
  enabled: boolean;

  createWallet(): Promise<CreatedWallet>;
  importWallet(secret: string, format: ImportFormat): Promise<ImportedWallet>;
  deriveReceiveAddress(walletId: string): Promise<string>;
  signMessage(walletId: string, message: Uint8Array): Promise<Uint8Array>;
  exportPublicSurface(walletId: string): Promise<PublicSurface>;
  exportWatchOnly?(walletId: string): Promise<WatchOnlyExport>;
}

export type ImportFormat = 'mnemonic' | 'private-key' | 'descriptor' | 'watch-only';

export interface CreatedWallet {
  walletId: string;
  chainId: ChainId;
  address: string;
  recoveryMaterial: string; // mnemonic or equivalent — shown once, then encrypted
}

export interface ImportedWallet {
  walletId: string;
  chainId: ChainId;
  address: string;
  watchOnly: boolean;
}

// ── Public Surface ────────────────────────────────────────────

export type SurfaceType = 'address' | 'descriptor' | 'xpub' | 'did';

export interface PublicSurface {
  chainId: ChainId;
  surfaceType: SurfaceType;
  value: string;
  label?: string;
}

export interface WatchOnlyExport {
  chainId: ChainId;
  format: string; // 'xpub', 'descriptor', 'address'
  data: string;
}

// ── Wallet Pouch ──────────────────────────────────────────────

export type WalletPurpose = 'vault' | 'receive' | 'identity' | 'oracle' | 'ops' | 'trading' | 'archive';
export type Visibility = 'private' | 'selective' | 'public';
export type ExposureLevel = 'cold' | 'warm' | 'public';

export interface ChainWalletRef {
  walletId: string;
  chainId: ChainId;
  chainFamily?: ChainFamily;
  label: string;
  purpose: WalletPurpose;
  visibility: Visibility;
  address: string;
  watchOnly: boolean;
  signingAuthority?: 'vault' | 'metamask' | 'walletconnect' | 'external' | 'watch-only';
  publicSurfaces: PublicSurface[];
}

export interface PouchCompartment {
  compartmentId: string;
  label: string;
  purpose: string;
  memberWalletIds: string[];
  exposureLevel: ExposureLevel;
}

export interface BackupPolicy {
  encryptedBackupRequired: boolean;
  plaintextBackupAllowed: boolean;
  plaintextBackupAdvancedOnly: boolean;
  requireTypedWarning: boolean;
}

export interface WalletPouch {
  pouchId: string;
  name: string;
  createdAt: string;
  cypherpunk2048Version: string;
  wallets: ChainWalletRef[];
  compartments: PouchCompartment[];
  backupPolicy: BackupPolicy;
}

// ── Vault Identity ────────────────────────────────────────────

export interface VerificationMethod {
  methodId: string;
  chainId: ChainId;
  kind: 'message-signature' | 'transaction-proof' | 'challenge-response';
  publicSurfaceRef: string;
}

export interface IntentRoute {
  routeId: string;
  chainId: ChainId;
  challengeType: 'message' | 'note-transaction' | 'watch-only-proof';
  publicSurfaceRef: string;
}

export interface VaultIdentity {
  identityId: string;
  pouchId: string;
  label: string;
  presentedSurfaces: PublicSurface[];
  verificationMethods: VerificationMethod[];
  intents: IntentRoute[];
}

// ── Default Policies ──────────────────────────────────────────

export const DEFAULT_BACKUP_POLICY: BackupPolicy = {
  encryptedBackupRequired: true,
  plaintextBackupAllowed: false,
  plaintextBackupAdvancedOnly: true,
  requireTypedWarning: true,
};
