// bankon-vault/2 is in the tree but not compiled into this build (VAULT_V2_IN_BUILD).
// These pin the degraded contract: reads report the v1 vault honestly, and every
// v2 write refuses before anything reaches IPC.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls: string[] = [];

vi.mock('../platform', () => ({
  isTauri: true,
  invoke: async (cmd: string) => {
    calls.push(cmd);
    if (cmd === 'vault_status') {
      return { exists: true, unlocked: false, accounts: [{ address: 'A1', chain: 'algorand', label: 'main' }] };
    }
    throw new Error(`Command ${cmd} not found`);
  },
}));

import {
  VAULT_V2_IN_BUILD, VaultV2Unavailable,
  vaultV2Status, vaultMigrationPlan, vaultKdfProfile, vaultAutoLockStatus,
  vaultMigrate, vaultChangePassphrase, vaultRemoveCustodian, vaultBindingMessage, vaultSetAutoLock,
} from '../vault';

describe('bankon-vault/2 absent from this build', () => {
  beforeEach(() => { calls.length = 0; });

  it('is switched off', () => {
    expect(VAULT_V2_IN_BUILD).toBe(false);
  });

  it('reports the v1 vault as it is', async () => {
    const s = await vaultV2Status();
    expect(s).toMatchObject({
      format: 'bankon-vault/1', exists: true, needsMigration: false, unlocked: false,
      entryCount: 1, custodians: [], v2Available: false,
    });
    expect(calls).toEqual(['vault_status']);
  });

  it('offers no migration, KDF profile or auto-lock', async () => {
    expect((await vaultMigrationPlan()).needed).toBe(false);
    expect(await vaultKdfProfile()).toBeNull();
    expect(await vaultAutoLockStatus()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('refuses every write before IPC', async () => {
    await expect(vaultMigrate('pw')).rejects.toBeInstanceOf(VaultV2Unavailable);
    await expect(vaultChangePassphrase('a', 'b')).rejects.toBeInstanceOf(VaultV2Unavailable);
    await expect(vaultRemoveCustodian('passphrase', 'x')).rejects.toBeInstanceOf(VaultV2Unavailable);
    await expect(vaultBindingMessage()).rejects.toBeInstanceOf(VaultV2Unavailable);
    await expect(vaultSetAutoLock(300)).rejects.toBeInstanceOf(VaultV2Unavailable);
    expect(calls).toEqual([]);
  });
});
