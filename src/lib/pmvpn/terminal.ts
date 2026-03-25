// pmVPN Module — Terminal Manager
// GPL-3.0 (Parsec client module)
//
// Manages xterm.js terminal instances.
// Data flow: xterm → Tauri command → russh → server PTY → russh → Tauri event → xterm

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { sendTerminalData, resizeTerminal, onTerminalData } from './connector';

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  destroy: () => void;
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
  let unlisten: (() => void) | null = null;
  onTerminalData(sessionId, (data) => {
    terminal.write(data);
  }).then((fn) => {
    unlisten = fn;
  });

  // Resize → server
  terminal.onResize(({ cols, rows }) => {
    resizeTerminal(sessionId, cols, rows).catch(() => {});
  });

  function destroy(): void {
    unlisten?.();
    terminal.dispose();
  }

  return { terminal, fitAddon, destroy };
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

  // Re-fit on window resize
  const observer = new ResizeObserver(() => {
    instance.fitAddon.fit();
  });
  observer.observe(container);
}
