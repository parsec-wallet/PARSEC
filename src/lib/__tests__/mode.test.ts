import { afterEach, describe, expect, it } from 'vitest';
import { __resetMode, arm, assertAllowed, disarm, getMode, onModeChange, VIEWING_COMMANDS, ViewingModeError } from '../mode';

afterEach(() => __resetMode());

describe('viewing and armed modes', () => {
  it('starts in viewing mode', () => {
    expect(getMode()).toBe('viewing');
  });

  it('refuses every key, signing, bridge and volume command while viewing', () => {
    for (const cmd of [
      'vault_unlock', 'vault_retrieve_key', 'vault_store_key', 'vault_create', 'vault_destroy', 'vault_list_accounts',
      'chain_algo_sign_transaction', 'chain_algo_reveal_mnemonic', 'chain_evm_sign_tx', 'chain_sol_sign', 'chain_ar_sign',
      'chain_ar_export_jwk', 'vault_export_secret', 'chain_btc_sign_psbt', 'connect_start', 'connect_approve_sign', 'connect_approve_name',
      'tomb_open', 'tomb_create', 'pmvpn_connect', 'pmvpn_sign_challenge', 'sandbox_grant', 'search_index',
      'keystore_retrieve', 'keystore_store', 'some_command_added_later',
    ]) {
      expect(() => assertAllowed(cmd), cmd).toThrow(ViewingModeError);
    }
  });

  it('never allows a signing, key-revealing or approving command in viewing mode', () => {
    for (const cmd of VIEWING_COMMANDS) {
      if (cmd.startsWith('connect_reject_')) continue; // refusing a signature is teardown
      expect(cmd).not.toMatch(/sign(?!_)|_sign|reveal|export|retrieve|store_key|unlock|create|approve|import|grant|open|connect_start|pmvpn_connect/);
    }
  });

  it('always allows teardown, so a session can never be trapped open', () => {
    for (const cmd of ['vault_lock', 'connect_stop', 'connect_disconnect_session', 'connect_reject_sign', 'pmvpn_disconnect', 'tomb_slam']) {
      expect(() => assertAllowed(cmd)).not.toThrow();
    }
  });

  it('allows everything once armed, and refuses again after disarming', () => {
    arm();
    expect(() => assertAllowed('chain_algo_sign_transaction')).not.toThrow();
    disarm();
    expect(() => assertAllowed('chain_algo_sign_transaction')).toThrow(ViewingModeError);
  });

  it('tells listeners about real changes only', () => {
    const seen: string[] = [];
    const off = onModeChange((m) => seen.push(m));
    arm(); arm(); disarm();
    off();
    arm();
    expect(seen).toEqual(['armed', 'viewing']);
  });
});
