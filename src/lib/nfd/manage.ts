// Management operations on an NFD the caller owns. Pass-through to the
// SDK's manager surface plus Parsec signer wiring.

import type { NetworkId } from '../../types/wallet';
import { getNfdClient } from './client';
import { makeParsecSigner } from './signer';
import type { Nfd } from './types';

export interface ManageContext {
  network: NetworkId;
  nfdNameOrAppId: string | number | bigint;
  owner: string;
  passphrase: string;
}

/** Link a verified Algorand address to an NFD the caller owns. */
export async function linkAddress(
  ctx: ManageContext,
  addressToLink: string,
): Promise<Nfd> {
  const client = getNfdClient(ctx.network).setSigner(
    ctx.owner,
    makeParsecSigner(ctx.owner, ctx.passphrase),
  );
  return client.manage(ctx.nfdNameOrAppId).linkAddress(addressToLink);
}

export async function unlinkAddress(
  ctx: ManageContext,
  addressToUnlink: string,
): Promise<Nfd> {
  const client = getNfdClient(ctx.network).setSigner(
    ctx.owner,
    makeParsecSigner(ctx.owner, ctx.passphrase),
  );
  return client.manage(ctx.nfdNameOrAppId).unlinkAddress(addressToUnlink);
}

export async function setMetadata(
  ctx: ManageContext,
  metadata: Record<string, string>,
): Promise<Nfd> {
  const client = getNfdClient(ctx.network).setSigner(
    ctx.owner,
    makeParsecSigner(ctx.owner, ctx.passphrase),
  );
  return client.manage(ctx.nfdNameOrAppId).setMetadata(metadata);
}

export async function setPrimaryAddress(
  ctx: ManageContext,
  address: string,
): Promise<Nfd> {
  const client = getNfdClient(ctx.network).setSigner(
    ctx.owner,
    makeParsecSigner(ctx.owner, ctx.passphrase),
  );
  return client.manage(ctx.nfdNameOrAppId).setPrimaryAddress(address);
}

export async function setPrimaryNfd(
  ctx: ManageContext,
  address: string,
): Promise<Nfd> {
  const client = getNfdClient(ctx.network).setSigner(
    ctx.owner,
    makeParsecSigner(ctx.owner, ctx.passphrase),
  );
  return client.manage(ctx.nfdNameOrAppId).setPrimaryNfd(address);
}
