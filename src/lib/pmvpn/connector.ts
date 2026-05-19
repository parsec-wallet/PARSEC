// pmVPN Module — Connection Orchestrator
// GPL-3.0 (Parsec client module)
//
// Orchestrates the full connection flow:
// 1. Fetch challenge nonce from server
// 2. Sign with wallet via bankon_vault
// 3. Connect SSH with signed payload
// 4. Manage terminal I/O

import { invoke, listen } from '../platform';
import { fetchChallenge, signChallenge, buildAuthPayload } from './auth';
import { pmvpnStore } from './store';
import type { PmvpnHost } from './types';

const PORT_OFFSET_CHALLENGE = 3;
const PORT_OFFSET_SHELL = 0;

/**
 * Connect to a PMVPN host.
 * Full flow: challenge → sign → SSH connect → terminal ready.
 */
export async function connectToHost(host: PmvpnHost): Promise<string> {
  pmvpnStore.setConnectionState('connecting');

  try {
    // 1. Fetch challenge
    pmvpnStore.setConnectionState('authenticating');
    const challenge = await fetchChallenge(
      host.host,
      host.basePort + PORT_OFFSET_CHALLENGE,
      host.walletAddress,
    );

    // 2. Sign with wallet (Rust-side via bankon_vault)
    const signature = await signChallenge(host.walletAddress, challenge.message);

    // 3. Build auth payload
    const authPayload = buildAuthPayload(host.walletAddress, signature, challenge.nonce);

    // 4. SSH connect via Rust (russh)
    const sessionId = await invoke<string>('pmvpn_connect', {
      host: host.host,
      port: host.basePort + PORT_OFFSET_SHELL,
      authPayload,
    });

    // 5. Store session
    pmvpnStore.addSession({
      id: sessionId,
      hostId: host.id,
      connected: true,
      connectedAt: Date.now(),
    });

    pmvpnStore.setConnectionState('connected');
    return sessionId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pmvpnStore.setConnectionState('error', msg);
    throw err;
  }
}

/**
 * Disconnect from a host.
 */
export async function disconnectFromHost(hostId: string): Promise<void> {
  const session = pmvpnStore.getSession(hostId);
  if (!session) return;

  try {
    await invoke('pmvpn_disconnect', { sessionId: session.id });
  } catch {
    // Best effort
  }

  pmvpnStore.removeSession(hostId);
  pmvpnStore.setConnectionState('disconnected');
}

/**
 * Send data to the terminal (keystrokes → SSH channel).
 */
export async function sendTerminalData(sessionId: string, data: string): Promise<void> {
  await invoke('pmvpn_send_data', { sessionId, data });
}

/**
 * Resize the remote PTY.
 */
export async function resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  await invoke('pmvpn_resize', { sessionId, cols, rows });
}

/**
 * Listen for terminal output from the server.
 * Returns an unlisten function.
 */
export async function onTerminalData(
  sessionId: string,
  callback: (data: string) => void,
): Promise<() => void> {
  const unlisten = await listen<{ sessionId: string; data: string }>('pmvpn-terminal-data', (event) => {
    if (event.payload.sessionId === sessionId) {
      callback(event.payload.data);
    }
  });
  return unlisten;
}

/**
 * Disconnect all sessions (called on Parsec lock).
 */
export async function disconnectAll(): Promise<void> {
  const state = pmvpnStore.get();
  for (const [hostId] of state.sessions) {
    await disconnectFromHost(hostId).catch(() => {});
  }
  pmvpnStore.clearSessions();
}
