// What the permaweb module elects. It asks for signatures — ANS-104 uploads through the Rust
// Arweave signer, Solana-era registry and stake writes through the vault-backed kit signer — and
// never for a key. Every reading leaves the device (gateways, Turbo, a Solana RPC), the RPC choice
// and the gateway form live in device storage, and the Solana RPC is the participant's to change.

import type { ModuleChoices } from '../module-choices';

export const PERMAWEB_ID = 'permaweb';

export const PERMAWEB_CHOICES: ModuleChoices = {
  privilege: 'sign',
  reach: 'external',
  persistence: 'device',
  provider: 'optional-external',
};
