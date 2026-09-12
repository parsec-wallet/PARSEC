// PARSEC — Multi-Chain Transaction Builder Types
// Unified transaction format across all chains.
// Isolation-first: each chain family is a cryptographic boundary.
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

// ── Chain Family Classification ──────────────────────────────
// Each family is a cryptographic isolation zone.
// Keys NEVER cross family boundaries.

export type ChainFamily = 'algorand' | 'evm' | 'utxo' | 'cryptonote' | 'zilliqa' | 'cardano' | 'arweave';

export interface ChainDescriptor {
  chainId: string;              // e.g. 'ethereum', 'bitcoin', 'polygon', 'xmr'
  family: ChainFamily;
  name: string;
  networkId?: number;           // EVM chain ID (1, 137, 42161, etc.)
  networkType: NetworkType;
  ticker: string;
  decimals: number;
  rpcUrl?: string;
  explorerUrl?: string;
  enabled: boolean;
}

export type NetworkType = 'mainnet' | 'testnet' | 'l2' | 'l3' | 'sidechain' | 'appchain';

// ── Signing Authority ────────────────────────────────────────
// Who holds the private key and how signing is dispatched.

export type SigningAuthority =
  | 'vault'             // PARSEC vault (Rust AES-256-GCM) — we hold the key
  | 'metamask'          // MetaMask injection — THEY hold the key
  | 'walletconnect'     // WalletConnect bridge — THEY hold the key
  | 'external'          // Any external signer — THEY hold the key
  | 'watch-only';       // No signing capability

// ── Isolation Context ────────────────────────────────────────
// Encapsulates the security boundary for a signing operation.

export interface IsolationContext {
  family: ChainFamily;
  authority: SigningAuthority;
  chainId: string;
  address: string;
  // When authority is 'vault', the vault retrieves key ephemerally.
  // When authority is 'metamask'/'walletconnect'/'external', PARSEC
  // NEVER touches the private key — the external signer owns it entirely.
  externalOnly: boolean;        // true = PARSEC has zero key access
}

// ── Unified Transaction Intent ───────────────────────────────

export interface ParsecTx {
  chain: string;                // chain descriptor ID
  family: ChainFamily;
  from: string;
  to: string;
  amount: number;               // native units per chain
  data?: string;                // EVM calldata (hex)
  note?: string;                // Algorand note field
  memo?: string;                // UTXO/CryptoNote memo
  assetId?: string;             // token/asset identifier
  // UTXO-specific
  utxos?: UTXOInput[];
  changeAddress?: string;
  // CryptoNote-specific
  ringSize?: number;
  priority?: number;
  // Zilliqa-specific
  scillaCode?: string;
  scillaData?: string;
  gasPrice?: string;
  gasLimit?: number;
  // Cardano-specific (eUTXO)
  cardanoInputs?: CardanoUTXO[];
  cardanoOutputs?: CardanoOutput[];
  ttl?: number;
  nativeAssets?: CardanoNativeAsset[];
  // Arweave-specific
  arData?: Uint8Array;          // data payload for upload transactions
  arTags?: { name: string; value: string }[];
  arAnchor?: string;            // lastTx anchor override
}

export interface UTXOInput {
  txHash: string;
  outputIndex: number;
  value: number;
  script?: string;
}

// ── Built Transaction (chain-specific output) ────────────────

export interface BuiltTransaction {
  chain: string;
  family: ChainFamily;
  type: string;
  raw: Uint8Array | EthTxRequest | UTXORawTx | CryptoNoteRawTx | ZilliqaRawTx | CardanoRawTx | ArweaveRawTx;
  meta: AlgorandTxMeta | EthereumTxMeta | UTXOTxMeta | CryptoNoteTxMeta | ZilliqaTxMeta | CardanoTxMeta | ArweaveTxMeta;
  isolation: IsolationContext;
}

export interface AlgorandTxMeta {
  fee: number;
  firstRound: number;
  lastRound: number;
}

export interface EthereumTxMeta {
  chainId: number;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
}

export interface UTXOTxMeta {
  inputCount: number;
  outputCount: number;
  estimatedFee: number;
  estimatedSize: number;
}

export interface CryptoNoteTxMeta {
  ringSize: number;
  fee: number;
  paymentId?: string;
}

export interface ZilliqaTxMeta {
  version: number;              // chain_id << 16 + tx version
  nonce: number;
  gasPrice: string;             // Qa (smallest unit)
  gasLimit: number;
}

export interface CardanoTxMeta {
  fee: bigint;                  // lovelace
  ttl?: number;                 // slot number
  inputCount: number;
  outputCount: number;
  auxiliaryDataHash?: string;
}

export interface ArweaveTxMeta {
  dataSize: number;             // bytes
  reward: string;               // winston (1 AR = 10^12 winston)
  lastTx: string;               // anchor — last tx hash from wallet
  target?: string;              // recipient (for AR transfers)
  quantity?: string;            // winston amount (for AR transfers)
  tags: { name: string; value: string }[];
}

// Arweave: RSA-4096 keypairs stored as JWK (RFC 7517).
// Signing: RSA-PSS + SHA-256, 512-byte signatures.
// Address: SHA-256(base64url_decode(jwk.n)) → base64url.
// Also supports Ed25519 and ES256K via signature_type field.
export interface ArweaveRawTx {
  format: 2;                    // Arweave tx format v2
  id: string;                   // tx hash (set after signing)
  owner: string;                // base64url RSA public modulus (n)
  target: string;               // recipient address (empty for data-only)
  quantity: string;             // winston amount
  reward: string;               // miner fee in winston
  lastTx: string;               // anchor
  data: string;                 // base64url data payload
  dataSize: string;
  dataRoot: string;             // merkle root of data chunks
  tags: { name: string; value: string }[];
  signature: string;            // base64url RSA-PSS signature (empty before signing)
}

// Arweave JWK key format (RSA-4096)
export interface ArweaveJWK {
  kty: 'RSA';
  e: string;                    // public exponent (base64url)
  n: string;                    // public modulus (base64url)
  d?: string;                   // private exponent (base64url) — only in private key
  p?: string;
  q?: string;
  dp?: string;
  dq?: string;
  qi?: string;
}

// ── Raw Transaction Shapes ───────────────────────────────────

export interface EthTxRequest {
  from: string;
  to: string;
  value: string;                // hex wei value
  data: string;
  chainId?: number;             // EVM chain ID for replay protection
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
}

export interface UTXORawTx {
  hex: string;                  // serialized unsigned tx
  inputs: UTXOInput[];
  outputs: { address: string; value: number }[];
}

export interface CryptoNoteRawTx {
  blob: string;                 // serialized unsigned tx blob
  keyImages: string[];
  fee: number;
}

// Zilliqa: Schnorr signatures over secp256k1 (NOT ECDSA).
// Native protocol uses Scilla. Zilliqa 2.0 adds EVM compat layer.
export interface ZilliqaRawTx {
  version: number;
  nonce: number;
  toAddr: string;               // bech32 zil1... or base16 0x...
  amount: string;               // Qa units (1 ZIL = 10^12 Qa)
  gasPrice: string;
  gasLimit: number;
  code?: string;                // Scilla contract code
  data?: string;                // Scilla transition parameters (JSON)
}

// Cardano: Ed25519-BIP32 extended keys, eUTXO, native multi-asset.
export interface CardanoRawTx {
  cborHex: string;              // CBOR-serialized unsigned transaction
  inputs: CardanoUTXO[];
  outputs: CardanoOutput[];
  fee: bigint;
  ttl?: number;
  metadata?: Record<string, unknown>;
}

export interface CardanoUTXO {
  txHash: string;
  outputIndex: number;
  lovelace: bigint;
  assets?: CardanoNativeAsset[];
}

export interface CardanoOutput {
  address: string;              // bech32 addr1...
  lovelace: bigint;
  assets?: CardanoNativeAsset[];
}

export interface CardanoNativeAsset {
  policyId: string;
  assetName: string;
  quantity: bigint;
}

// ── Ethereum provider interface (no ethers dependency) ───────
// Any EIP-1193 compatible provider or ethers-like signer works.

export interface EthSigner {
  getAddress(): Promise<string>;
  populateTransaction(tx: EthTxRequest): Promise<EthTxRequest & {
    gasLimit?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  }>;
}

export interface EthProvider {
  getSigner(address?: string): EthSigner;
}

// ── EIP-1193 (MetaMask / injected) ──────────────────────────

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

// ── Signing Modes ────────────────────────────────────────────

export type SigningMode = 'walletconnect' | 'metamask' | 'vault' | 'external';

// ── WalletConnect Types ──────────────────────────────────────

export interface WCMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export interface WCNamespace {
  methods: string[];
  chains: string[];
  events: string[];
}

export interface WCSession {
  topic: string;
  namespaces: Record<string, { accounts: string[] }>;
}

export interface WCSignRequest {
  chain: string;
  txn: Uint8Array | EthTxRequest;
}

export interface WCAccounts {
  algorand?: string[];
  eip155?: string[];
  [namespace: string]: string[] | undefined;
}
