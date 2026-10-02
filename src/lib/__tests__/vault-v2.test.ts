// bankon-vault/2 is the vault in this build (0.2.7). These pin the wrappers' contract:
// each reaches its Keycore command with the arguments the Rust side expects.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls: [string, unknown][] = [];

vi.mock('../platform', () => ({
  isTauri: true,
  invoke: async (cmd: string, args?: unknown) => {
    calls.push([cmd, args]);
    if (cmd === 'vault_v2_status') {
      return { format: 'bankon-vault/2', exists: true, needsMigration: false, v1FilesPresent: true, unlocked: true, entryCount: 2, custodians: [], accounts: [] };
    }
    if (cmd === 'vault_binding_message') return { message: 'BANKON-VAULT-KEY-BINDING/2\n…' };
    return { ok: true, removed: true };
  },
}));

import {
  VAULT_V2_IN_BUILD, vaultV2Status, vaultRemoveCustodian, vaultBindingMessage,
  vaultAddSignatureCustodian, vaultRemoveV1Files,
} from '../vault';

describe('bankon-vault/2 in this build', () => {
  beforeEach(() => { calls.length = 0; });

  it('is switched on', () => {
    expect(VAULT_V2_IN_BUILD).toBe(true);
  });

  it('reads the v2 status from the Keycore', async () => {
    const s = await vaultV2Status();
    expect(s).toMatchObject({ format: 'bankon-vault/2', v1FilesPresent: true, v2Available: true });
    expect(calls.map((c) => c[0])).toEqual(['vault_v2_status']);
  });

  it('custodian changes and the v1 clean-up carry the passphrase', async () => {
    await vaultRemoveCustodian('passphrase', 'old', 'pw');
    await vaultAddSignatureCustodian({ chain: 'algorand', address: 'A', label: 'pera', signatureB64: 'c2ln', passphrase: 'pw' });
    await vaultRemoveV1Files('pw');
    expect(calls).toEqual([
      ['vault_remove_custodian', { kind: 'passphrase', label: 'old', passphrase: 'pw' }],
      ['vault_add_signature_custodian', { chain: 'algorand', address: 'A', label: 'pera', signatureB64: 'c2ln', passphrase: 'pw' }],
      ['vault_remove_v1_files', { passphrase: 'pw' }],
    ]);
  });

  it('the binding message is asked for a named address', async () => {
    expect((await vaultBindingMessage('ADDR')).message).toContain('BANKON-VAULT-KEY-BINDING/2');
    expect(calls).toEqual([['vault_binding_message', { address: 'ADDR' }]]);
  });
});
