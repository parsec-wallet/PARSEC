# Parsec Connect — Wallet-Side Architecture

Internal documentation for the Parsec Connect module that enables web dApps to communicate with Parsec Wallet for transaction signing.

## Module Structure

```
src-tauri/src/parsec_connect/
├── mod.rs          # Types: ConnectState, DappSession, SignRequest, SignResponse, JSON-RPC
├── server.rs       # Axum WebSocket server with health, info, and WS endpoints
└── commands.rs     # 7 Tauri IPC commands for frontend control

src/lib/connect.ts  # TypeScript IPC client for frontend
src/views/connect-approve.ts  # Approval dialog view (x402-confirm pattern)
```

## How It Works

### Server Lifecycle

1. When user unlocks wallet and lands on dashboard, `main.ts` calls `connectStart(address)`
2. This spawns an axum server on `localhost:9876` via `tokio::spawn`
3. The server exposes:
   - `GET /parsec/v1/connect/health` — detection endpoint for dApps
   - `GET /parsec/v1/connect/info` — detailed wallet info
   - `GET /parsec/v1/connect/ws` — WebSocket upgrade for JSON-RPC

### Sign Request Flow

```
1. dApp sends: parsec_signTransactions { txns, origin, message }
2. Server creates SignRequest + mpsc channel
3. Server emits Tauri event: "parsec-connect-sign-request"
4. main.ts listener catches event, calls setConnectPending(request)
5. main.ts navigates to 'connect-approve' view
6. User sees approval dialog with origin, txn count, message
7a. User approves → view retrieves mnemonic from vault, signs, calls connectApproveSign()
7b. User rejects → view calls connectRejectSign()
8. IPC command sends SignResponse through the mpsc channel
9. Server receives response, sends JSON-RPC result back to dApp
10. View navigates back to dashboard
```

### Security Layers

1. **CORS** — Only configured origins can connect (default: `https://agenticplace.pythai.net`)
2. **Localhost binding** — Server only listens on `127.0.0.1`, not exposed to network
3. **User approval** — Every sign request shows a dialog; no silent signing
4. **Vault-secured keys** — Mnemonic retrieved from Argon2id+AES-256-GCM vault only during signing
5. **Mnemonic zeroing** — Mnemonic set to null after signing (GC eligible)
6. **Transaction limit** — Max 16 transactions per sign request
7. **Timeout** — Requests auto-reject after 120 seconds

### Session Management

- Each WebSocket connection gets a unique `session_id` (timestamp-based)
- Sessions tracked in `ConnectSession.sessions` HashMap
- When a dApp disconnects, pending sign requests for that session are auto-rejected
- Frontend can list sessions via `connect_sessions()` IPC
- Frontend can force-disconnect a session via `connect_disconnect_session()`

## IPC Commands

| Command | Parameters | Returns | Purpose |
|---------|-----------|---------|---------|
| `connect_start` | `port?, allowed_origins?, active_address` | `String` | Start server |
| `connect_stop` | — | `()` | Stop server |
| `connect_sessions` | — | `Vec<DappSession>` | List connected dApps |
| `connect_pending_requests` | — | `Vec<SignRequest>` | Get pending requests |
| `connect_approve_sign` | `request_id, signed_txns_b64` | `()` | Approve + send signed txns |
| `connect_reject_sign` | `request_id, reason?` | `()` | Reject request |
| `connect_disconnect_session` | `session_id` | `()` | Force disconnect dApp |

## Tauri Events

| Event | Payload | Direction |
|-------|---------|-----------|
| `parsec-connect-sign-request` | `SignRequest` | Rust → Frontend |
| `parsec-connect-session` | `{ type: "connected"/"disconnected", sessionId }` | Rust → Frontend |

## Types

### SignRequest

```typescript
interface SignRequest {
  request_id: number;
  session_id: string;
  origin: string;         // e.g. "https://agenticplace.pythai.net"
  message: string;        // Human-readable description
  txn_count: number;
  txns_b64: string[];     // Base64-encoded unsigned transaction bytes
  created_at: number;     // Unix timestamp
}
```

### DappSession

```typescript
interface DappSession {
  session_id: string;
  origin: string;
  connected_at: number;
  account_address: string | null;
}
```

## Dependencies

**Rust:**
- `axum` 0.7 with `ws` feature — WebSocket server
- `tower-http` 0.6 with `cors` feature — CORS middleware
- `tokio` — async runtime (already a dependency)
- `serde_json` — JSON-RPC message handling

**TypeScript:**
- `@tauri-apps/api/core` — `invoke()` for IPC
- `@tauri-apps/api/event` — `listen()` for sign request events
- `algosdk` — transaction decoding and signing

## View Registration

The connect-approve view is registered in `main.ts`:

```typescript
import { connectApproveView, setConnectPending } from './views/connect-approve';
registerView('connect-approve', connectApproveView);
```

And added to the `AppView` union type in `types/wallet.ts`:

```typescript
export type AppView = ... | 'connect-approve';
```

## Future Improvements

- [ ] Sandbox integration: check `parsec_sandbox` permissions before processing sign requests
- [ ] Multiple account support: let dApp request specific accounts
- [ ] Message signing: `parsec_signBytes` method for identity challenges
- [ ] Network switching: `parsec_switchNetwork` method
- [ ] Session persistence: remember approved dApps across restarts
- [ ] Connect settings in settings view: port config, origin whitelist management
