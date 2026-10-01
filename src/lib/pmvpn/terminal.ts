// pmVPN Module — Terminal Manager
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Manages xterm.js terminal instances.
// Data flow: xterm → Tauri command → russh → server PTY → russh → Tauri event → xterm

import { bindObserver } from '../lifecycle';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { sendTerminalData, resizeTerminal, onTerminalData } from './connector';

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  destroy: () => void;
  /** Set by mountTerminal: disconnects the resize observer. */
  detach?: () => void;
}

/**
 * Create a terminal instance attached to a PMVPN session.
 * Mount the returned terminal into a DOM element.
 */
export function createTerminal(sessionId: string): TerminalInstance {
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39d353',
      white: '#b1bac4',
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  // Keystrokes → server
  terminal.onData((data) => {
    sendTerminalData(sessionId, data).catch(() => {
      // Connection lost — handled by disconnect event
    });
  });

  // Server output → terminal
  // The Tauri listener is registered asynchronously. If the terminal is
  // destroyed before that resolves, `unlisten` is still null — so the listener
  // is removed the moment it arrives instead of living for the process.
  let unlisten: (() => void) | null = null;
  let disposed = false;
  onTerminalData(sessionId, (data) => {
    if (!disposed) terminal.write(data);
  }).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });

  // Resize → server
  terminal.onResize(({ cols, rows }) => {
    resizeTerminal(sessionId, cols, rows).catch(() => {});
  });

  const instance: TerminalInstance = { terminal, fitAddon, destroy };

  function destroy(): void {
    if (disposed) return;
    disposed = true;
    unlisten?.();
    unlisten = null;
    instance.detach?.();
    terminal.dispose();
  }

  return instance;
}

/**
 * Mount a terminal into a DOM element and fit to container.
 */
export function mountTerminal(instance: TerminalInstance, container: HTMLElement): void {
  instance.terminal.open(container);
  // Delay fit to allow container to render
  requestAnimationFrame(() => {
    instance.fitAddon.fit();
  });

  // Re-fit on window resize.
  //
  // This observer was never disconnected. A ResizeObserver holds a strong
  // reference to everything it observes, so each terminal mount kept its
  // container — and the xterm instance behind the closure — alive for the life
  // of the process.
  const observer = new ResizeObserver(() => {
    instance.fitAddon.fit();
  });
  observer.observe(container);
  // Disconnected with the terminal, not only with the view: each connect mounts
  // a fresh terminal, and the old observer kept fitting a disposed one.
  instance.detach = () => observer.disconnect();
  bindObserver(observer);
}
