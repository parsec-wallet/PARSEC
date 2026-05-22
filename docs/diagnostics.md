# Diagnostics

An **opt-in, no-storage** screen that shows a participant the network and
system their PARSEC wallet is running on, and whether the services the wallet
depends on are reachable. It exists for situational awareness and as a light
tamper-detection layer — not for telemetry. Nothing it reads is ever stored.

## Principles

- **Off by default, at every level.** The screen is hidden until enabled in
  Settings, and inside it every *aspect* (Network, CPU, GPU, MAC, Services)
  has its own **shield toggle** that also starts off. Nothing runs — no
  polling, no backend calls — until a shield is lit.
- **No storage.** Readings live only in the view for the current render and
  are replaced on each poll. There is no caching, no `localStorage`, no write
  to wallet state. The single persisted value is the `enableDiagnostics`
  preference (a boolean — not network data).
- **Live.** While the screen is open it auto-polls every few seconds; leaving
  the screen stops polling and disables the backend monitor.

## Enabling it

`Settings → Diagnostics` — a shield toggle. Off shows nothing more; on reveals
an **Open Diagnostics** button. The preference persists; the readings never do.

## The shields

Each aspect is a shield: **dim/grey when off, lit when on**. Click to flip.

| Aspect   | What it shows                                                    |
|----------|------------------------------------------------------------------|
| Network  | Online status, connection type/speed, public IP, tamper watch    |
| CPU      | Processor model, core counts, live load %, frequency             |
| GPU      | Graphics adapter name + vendor (best-effort)                     |
| MAC      | Interface MAC addresses, and MAC spoofing                        |
| Services | Live reachability of IPFS, Arweave, Algorand/.algo, Solana       |

## Tabs

- **Connection** — `navigator` online state, connection type/speed where the
  platform reports it, and public IP (one-shot lookup). When Network is lit,
  a baseline of interfaces/IPs/MACs is captured; any later change is flagged
  as **possible outside tampering** — networking-on is itself a protection
  layer.
- **System** — CPU, GPU, and the local interface list. MAC addresses are
  hidden until the MAC shield is lit. Desktop-only (a webview cannot read
  this; the web build shows a notice).
- **Services** — one timed reachability probe per endpoint PARSEC uses, with
  status (ok / slow / unreachable) and latency.

## MAC spoofing

With the MAC shield lit, each interface offers **Spoof / randomize MAC** — it
sets a random, locally-administered address. This requires OS privilege
(root / admin); run unprivileged it fails harmlessly with a clear error. The
real MAC returns on the next network restart. Linux is wired today.

## Implementation

- **Rust** — `src-tauri/src/network_monitor/` (`commands.rs`): `network_info`
  (interfaces + MAC + CPU + GPU; gated by a `NetworkMonitorState.enabled`
  flag that is **false by default**), `network_monitor_set_enabled`, and
  `network_set_mac`. Crates: `network-interface`, `sysinfo`, `num_cpus`.
- **Frontend** — `src/lib/diagnostics/` (`types`, `system`, `endpoints`,
  `aspects`) and the view `src/views/diagnostics.ts`. Endpoint probes are
  `fetch` with an `AbortController` timeout and `cache: 'no-store'`.
