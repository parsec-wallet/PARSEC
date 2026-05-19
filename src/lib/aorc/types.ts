// Shared aORC types.

export type AorcNftStandard = 'arc-3' | 'arc-19' | 'arc-69';
export type AorcTokenType = 'aNFT' | 'dNFT' | 'iNFT' | 'THOT';

export interface AorcMintMeta {
  /** Asset name (≤ 32 chars on chain). */
  name: string;
  /** Unit name (≤ 8 chars on chain). */
  unitName: string;
  /** Total supply. NFTs use 1. */
  total: number;
  /** Decimal precision. NFTs use 0. */
  decimals: number;
  /** ARC-3 / ARC-19 URL. For ARC-19, must be a `template-ipfs:` URL. */
  url?: string;
  /** Optional metadata hash (32 bytes, base64-encoded). */
  metadataHash?: string;
  /** Free-form trait key/value pairs, included in ARC-69 note. */
  traits?: { key: string; value: string }[];
}

export interface AorcMintResult {
  assetId: number;
  txId: string;
  /** Block round the mint confirmed in. */
  confirmedRound: number;
  /** The Arweave tx-id that carries the binding proof, if uploaded. */
  proofArweaveTxId?: string;
}
