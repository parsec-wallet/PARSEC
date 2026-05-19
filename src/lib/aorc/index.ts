// aORC barrel. Re-export the surface every view consumes.

export { getAorcIds, isAorcConfigured, type AorcAppIds } from './ids';
export {
  buildMintTxn,
  signAndSendMint,
} from './minter';
export {
  buildTypeMintTxn,
  isCidMinted,
  signAndSendTypeMint,
} from './type-minter';
export type {
  AorcMintMeta,
  AorcMintResult,
  AorcNftStandard,
  AorcTokenType,
} from './types';
