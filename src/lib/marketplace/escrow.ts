// Composite escrow helpers — chain a BNR/ANT transfer to the BMR with a
// follow-up Receive-Asset notice. v1 trusts the BMR's own on-transfer
// handler to pick up the BNR Transfer-Notice; this helper just provides
// a single TS function for the UI to call.

import { signDataItemFromVault } from '../arweave/ans104';
import { aoMessage } from '../arweave/ao';
import { buildTransferBankonInput } from '../bankon-names/client';
import { transferAntOwnership } from '../arweave/ant';
import { buildArweaveSigner } from '../arweave/signer';
import { getBmrProcessId } from './process-id';

/** Move a BANKON name into the BMR's custody. The BMR's on-transfer-notice
 * handler will mark the listing as `escrowed` shortly after. */
export async function escrowBankonName(opts: {
  address: string;
  passphrase: string;
  name: string;
}): Promise<{ id: string }> {
  const bmr = getBmrProcessId();
  if (!bmr) throw new Error('BMR not configured');
  const signed = await signDataItemFromVault(
    opts.address,
    opts.passphrase,
    buildTransferBankonInput({ name: opts.name, to: bmr }),
  );
  await aoMessage(signed);
  return { id: signed.id };
}

/** Move an ANT (and the ArNS name it controls) into the BMR's custody. */
export async function escrowArnsName(opts: {
  address: string;
  passphrase: string;
  antProcessId: string;
}): Promise<{ id: string }> {
  const bmr = getBmrProcessId();
  if (!bmr) throw new Error('BMR not configured');
  const signer = await buildArweaveSigner(opts.address, opts.passphrase);
  try {
    return await transferAntOwnership({ signer, antProcessId: opts.antProcessId, to: bmr });
  } finally {
    signer.dispose();
  }
}
