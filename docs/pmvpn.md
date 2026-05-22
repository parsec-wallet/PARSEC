# pmVPN — wallet-authenticated SSH

> Permissioned SSH/terminal access where the wallet key is the credential.

## Overview

pmVPN gives Parsec a wallet-authenticated SSH terminal for remote-machine
access. Instead of an SSH password or static key, the **wallet signature** is
the credential — a challenge-response handshake proves control of the account
before a session opens.

## Connection flow

The connector (`src/lib/pmvpn/`) orchestrates:

1. **Fetch** a challenge nonce from the pmVPN server.
2. **Sign** the nonce with the wallet key via `bankon_vault`.
3. **Connect** the SSH session with the signed payload.
4. **Manage** terminal I/O (xterm.js front end).

## Key files

- `src/lib/pmvpn/` — connection orchestrator + connector.
- `src/views/pmvpn.ts` — the terminal view.
- `src-tauri/src/pmvpn/` — Rust-side SSH (5 IPC commands).

## Notes

Desktop (Tauri) feature — the SSH transport lives in the Rust backend. Licensed
GPL-3.0 as a Parsec client module.
