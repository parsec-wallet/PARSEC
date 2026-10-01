// PARSEC Wallet — viewing and armed modes
//
// The two pills are two modes of the same app, kept apart at runtime.
//
//   viewing  The Blue Pill and the Matrix landing. Stringent: no key material,
//            no signing, no dApp bridge, no encrypted-volume access — the IPC
//            boundary refuses every such command. Relaxed: nothing to unlock,
//            nothing to lose, so it can refresh, watch and explore freely.
//
//   armed    The Red Pill. A live wallet: the vault can be opened, keys can
//            sign, dApps can connect. Entered only through the Red Pill; left
//            only through a complete logout (lib/session.ts), which returns to
//            viewing.
//
// The mode is enforced where it cannot be bypassed: `platform.invoke` checks
// every Tauri command against it, and the keystore's browser fallback checks
// it before touching stored keys. A view that forgets which pill it is in
// still cannot reach a key from viewing mode.
//
// This module imports nothing from the app, so the IPC layer can depend on it
// without a cycle.

export type Mode = 'viewing' | 'armed';

let mode: Mode = 'viewing';
const listeners = new Set<(m: Mode) => void>();

export function getMode(): Mode {
  return mode;
}

export function isArmed(): boolean {
  return mode === 'armed';
}

function set(next: Mode): void {
  if (next === mode) return;
  mode = next;
  for (const fn of [...listeners]) {
    try { fn(mode); } catch { /* one listener must not stop the others */ }
  }
}

/** Enter armed mode. Only the Red Pill calls this. */
export function arm(): void { set('armed'); }

/** Return to viewing mode. Called by logout and by taking the Blue Pill. */
export function disarm(): void { set('viewing'); }

/** Be told when the mode changes. Returns the unsubscribe. */
export function onModeChange(fn: (m: Mode) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Commands viewing mode may send. Everything else needs the Red Pill.
 *
 * An allowlist, not a denylist: a command added to Rust later is refused in
 * viewing mode until someone decides it is safe to see without arming.
 *
 * Five kinds are allowed:
 *   - read-only checks: address validation, status, diagnostics readings
 *   - the arming door itself: the vault must be probed before it is unlocked
 *   - app setup that holds no secret: throttle, sandbox and mesh init
 *   - the desktop window: title bar controls, tray, close-to-tray, start at login
 *   - teardown: locking, disconnecting and refusing are always allowed —
 *     a mode that could not shut a session would trap it open
 */
export const VIEWING_COMMANDS: ReadonlySet<string> = new Set([
  // read-only
  'validate_address_algorand', 'validate_address_any', 'validate_address_bitcoin',
  'validate_address_cosmos', 'validate_address_evm', 'validate_address_solana',
  'vault_status', 'vault_profiles',
  'network_info', 'network_monitor_set_enabled',
  'throttle_check', 'throttle_stats',
  'tomb_status', 'tomb_detect_usb', 'tomb_check',
  'sandbox_level_info', 'sandbox_all_levels', 'sandbox_list_permissions',
  'sandbox_audit_log', 'sandbox_get_permission', 'sandbox_check',
  'search_health',
  'mesh_ipfs_status', 'mesh_resources', 'mesh_resource_cost',
  // setup, no secret
  'throttle_init', 'sandbox_init', 'mesh_init',
  // choosing which vault the door opens: holds no secret, and locks any open session
  'vault_profile_select',
  // the desktop window itself — the title bar, tray and start-at-login hold no
  // secret, and a window that could not be minimized or closed on the landing
  // (which is viewing mode) would be a broken window, not a safer one
  'app_shell_minimize', 'app_shell_toggle_maximize', 'app_shell_close', 'app_shell_quit',
  'app_shell_set_close_to_tray', 'app_shell_autostart_get', 'app_shell_autostart_set',
  'app_shell_started_hidden',
  // teardown — always allowed
  'vault_lock', 'tomb_slam', 'tomb_close',
  'connect_stop', 'connect_sessions', 'connect_pending_requests', 'connect_pending_name_requests',
  'connect_disconnect_session', 'connect_reject_sign', 'connect_reject_name',
  'pmvpn_disconnect',
]);

export class ViewingModeError extends Error {
  constructor(readonly command: string) {
    super(`"${command}" needs an armed wallet. The Blue Pill is view-only; take the Red Pill to use it.`);
    this.name = 'ViewingModeError';
  }
}

/** Throw unless `command` may run in the current mode. */
export function assertAllowed(command: string): void {
  if (mode === 'viewing' && !VIEWING_COMMANDS.has(command)) throw new ViewingModeError(command);
}

/** For tests: return to the default. */
export function __resetMode(): void {
  mode = 'viewing';
  listeners.clear();
}
