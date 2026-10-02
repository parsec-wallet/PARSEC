// 0.1.9: on the desktop the passphrase is not kept in JavaScript after unlock,
// no secret is read into JavaScript, and an export asks again.
import { describe, it, expect, vi } from 'vitest';

const invoke = vi.fn(async (cmd: string, _args?: unknown) => {
  if (cmd === 'vault_status') return { exists: true, unlocked: false, accounts: [] };
  if (cmd === 'vault_export_secret') return { secret: 's', chain: 'solana' };
  return { ok: true };
});
vi.mock('../platform', () => ({ isTauri: true, invoke: (c: string, a?: unknown) => invoke(c, a) }));
vi.mock('../vault', async (orig) => ({ ...(await orig<typeof import('../vault')>()), isTauri: () => true }));

const { store } = await import('../store');
const { keystoreUnlock, keystoreRetrieve, keystoreStore } = await import('../keystore');
const { vaultExportSecret } = await import('../vault');
const { KEYCORE_SESSION } = await import('../session-marker');

describe('the desktop session holds no passphrase', () => {
  it('the store keeps a marker, not the passphrase', () => {
    store.setPassphrase('correct horse battery staple');
    expect(store.getPassphrase()).toBe(KEYCORE_SESSION);
    store.setPassphrase(null);
    expect(store.getPassphrase()).toBeNull();
  });

  it('the marker never reaches vault_unlock (it would count as a failed attempt)', async () => {
    invoke.mockClear();
    expect(await keystoreUnlock(KEYCORE_SESSION)).toBe(false);
    await expect(keystoreStore('ADDR', 'secret', KEYCORE_SESSION)).rejects.toThrow(/locked/);
    expect(invoke.mock.calls.map((c) => c[0])).not.toContain('vault_unlock');
  });

  it('no secret is read into JavaScript', async () => {
    invoke.mockClear();
    await expect(keystoreRetrieve('ADDR', 'pw')).rejects.toThrow(/Keycore/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('an export sends the passphrase and the typed confirmation to the Keycore', async () => {
    await vaultExportSecret('ADDR', 'pw', 'ADDR');
    expect(invoke).toHaveBeenLastCalledWith('vault_export_secret', { args: { address: 'ADDR', passphrase: 'pw', confirm: 'ADDR' } });
  });
});
