// Public surface of parsec's Arweave permanent-storage extension.
//
// Phase 1: key sourcing — BIP-39-derived RSA-4096 and JWK import.
// Phase 2 (current): gateway client + vault-bridged tx builder + chunked upload.
// Phase 3+: Turbo upload, dApp bridge, AO. The shape of this index will grow
// as those phases land — additions only, no breaking changes.

export { arweaveHdModule } from './module';
export { deriveJwkFromMnemonic, deriveJwkInWorker } from './seed';
export {
  addressFromJwk,
  base64urlToBytes,
  bytesToBase64url,
  isArweaveAddress,
  isArweaveJwk,
  parseJwk,
} from './jwk';
export type { ArweaveJwk } from './jwk';
export {
  arToWinston,
  getAnchor,
  getArweaveClient,
  getData,
  getStorageCost,
  getTxStatus,
  resetArweaveClient,
  setArweaveGateway,
  winstonToAr,
} from './client';
export type { ArweaveGatewayConfig, TxStatus } from './client';
export {
  buildUploadTx,
  signTx,
  signTxFromVault,
  uploadData,
  uploadTx,
} from './tx';
export type {
  ArweaveTag,
  TxReceipt,
  UploadOptions,
  UploadProgress,
} from './tx';
export {
  decodeDataItemAsync,
  decodeTags,
  encodeTags,
  estimateDataItemSize,
  signDataItem,
  signDataItemFromVault,
  signDataItemWith,
  verifyDataItem,
} from './ans104';
export type {
  DataItemInput,
  DataItemSigner,
  DataItemTag,
  DecodedDataItem,
  SignedDataItem,
} from './ans104';
export {
  activeArweaveConfig,
  buildArweaveSigner,
} from './signer';
export type { ArweaveSigner } from './signer';
export {
  aoDryRun,
  aoMessage,
  aoResult,
  aoSpawn,
  buildAoMessageInput,
  buildAoSpawnInput,
  getAoEndpoints,
  setAoEndpoints,
} from './ao';
export type { AoEndpoints, AoMessageOutput, AoMessageResult } from './ao';
