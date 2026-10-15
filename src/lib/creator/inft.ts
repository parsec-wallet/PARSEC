// iNFT (permanence mint) — prepare only. After a deploy, the page can be described as an ERC-721
// style token: its metadata is built here and can be copied or uploaded (free, tiny) as
// metadata.json. Nothing here calls a contract: the iNFT contract is not deployed, and the view shows
// the mint disabled with the reason below.

import { effectiveDescription, effectiveTitle, hostLabel, type PageDoc } from './model';

export const INFT_MINT_ENABLED = false;
export const INFT_MINT_REASON =
  "The iNFT contract is not deployed yet — its audit is open (DeltaVerse/deploy/iNFT4/audit.json: cleared false). The mint will be the OVERLORD's signature.";

export interface InftAttribute { trait_type: string; value: string | number }

export interface InftMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  animation_url: string;
  storageURI: string;
  attributes: InftAttribute[];
}

const ID_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * ERC-721 metadata for a deployed page. `manifestId` is the page's Target ID; `imageId` the id of
 * its avatar or social card inside that deploy (the card when there is one — it is what wallets show).
 */
export function buildInftMetadata(doc: PageDoc, ids: { manifestId: string; imageId?: string }): InftMetadata {
  if (!ID_RE.test(ids.manifestId)) throw new Error('The Target ID must be a 43-character Arweave id');
  if (ids.imageId !== undefined && !ID_RE.test(ids.imageId)) throw new Error('The image id must be a 43-character Arweave id');
  const host = hostLabel(doc.domain);
  const title = effectiveTitle(doc);
  return {
    name: doc.profile.displayName.trim() || title,
    description: effectiveDescription(doc) || `A permanent page at ar://${host}`,
    image: `ar://${ids.imageId ?? ids.manifestId}`,
    external_url: `https://${host}.ar.io`,
    animation_url: `ar://${ids.manifestId}`,
    storageURI: `ar://${ids.manifestId}`,
    attributes: [
      { trait_type: 'Page title', value: title },
      { trait_type: 'Version', value: doc.version },
      { trait_type: 'Template', value: doc.theme.template },
      { trait_type: 'Address', value: `ar://${host}` },
    ],
  };
}

export function inftJson(m: InftMetadata): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}
