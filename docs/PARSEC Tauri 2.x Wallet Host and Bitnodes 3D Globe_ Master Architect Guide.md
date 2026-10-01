# PARSEC — Master Architect Guide & Best-Practices Reference

**A Tauri 2.x Host/Container Wallet Dapp Enveloping BANKON and Other Wallets, with a Scientifically Accurate Bitnodes-Style 3D Globe**

---

## TL;DR

- **Build PARSEC as a Tauri 2.x desktop shell** — a Rust core plus a React + TypeScript (Vite) frontend rendered in the OS-native webview — that acts as a multi-wallet *host/container*: it discovers and connects to heterogeneous wallets (BANKON among them) via WalletConnect v2 / Reown AppKit and EIP-6963, behind a unified adapter abstraction, **never custodying connected wallets' keys**.
- **Feature a CesiumJS WGS84-exact 3D globe** as the network-health view, plotting Bitnodes' reachable nodes (a representative recent snapshot reported `total_nodes` of 23,877) as Cesium points/billboards and peer relationships as `ArcType.GEODESIC` polylines, with **react-globe.gl/Three.js as the lighter alternative**; all geodesy (geodetic→ECEF, geodesic arc sampling) lives canonically in **Rust** (`geographiclib-rs`) and is pushed to the frontend over Tauri IPC/events as precomputed coordinates.
- **The Tauri pivot supersedes the prior Qt 6/PySide6 design** for the shell layer while preserving the data/geodesy concepts; chain adapters (EVM via alloy + Foundry-tested contracts, Algorand via x402-avm/USDC ASA 31566704, Bitcoin Core anchor via bitcoincore-rpc) live as Rust crates inside `src-tauri`, all under Apache-2.0, mainnet-only, no admin keys, no upgradeable proxies.

---

## Key Findings

Tauri 2.0 — released as a stable version on 2 October 2024 — is the correct foundation for PARSEC. Its architecture cleanly separates a fully-privileged Rust core process from a sandboxed system-WebView frontend, with a hardened IPC bridge governed by a permissions/capabilities ACL. This trust-boundary model is exactly what a wallet host needs: business logic, key-adjacent operations, and network polling stay in Rust, while the React UI is treated as untrusted by default. Tauri is dual-licensed MIT/Apache-2.0, fitting the user's Apache-2.0 posture, and produces binaries dramatically smaller than Electron because it does not bundle a browser engine — Tauri apps typically ship at 2–10 MB versus Electron's 80–200 MB, and Hoppscotch reported that migrating from Electron to Tauri cut its bundle "from 165 MB to 8 MB and a 70% reduction in memory usage."

The multi-wallet host pattern is well-established. WalletConnect v2 (now Reown) provides the session/pairing protocol with CAIP-2 namespaces (e.g. `eip155` for EVM chains); EIP-6963 solves multi-injected-provider discovery for browser-extension wallets; and the Solana wallet-adapter and EIP-1193 provide the conceptual blueprint for a chain-agnostic adapter interface. PARSEC "envelopes" BANKON by treating it as one adapter implementation behind this unified interface.

CesiumJS (Apache-2.0) is the right primary globe for scientific accuracy because it models the true WGS84 ellipsoid and supports geodesic polylines natively. react-globe.gl (a Three.js/WebGL wrapper) is the right lighter alternative when GPU-friendly simplicity matters more than geodetic exactness. Putting WGS84 geodesy in Rust via `geographiclib-rs` (Karney's algorithms, validated against Karney's authoritative GeodTest suite) gives one source of truth, type safety, and performance, with the frontend reduced to a pure renderer.

---

## Details

### 1. Tauri 2.x architecture for a wallet dapp

**Process & rendering model.** Tauri employs a multi-process architecture: a single Rust **Core process** manages one or more **WebView processes**, and it does not render UI itself — it spins up WebViews backed by the OS WebView library (per the official [Process Model](https://v2.tauri.app/concept/process-model/)). Rendering is abstracted through **WRY**, Tauri's cross-platform webview library, which targets **WKWebView** on macOS/iOS, **WebView2** (Chromium) on Windows, and **WebKitGTK** on Linux; window management uses **TAO** (see the [Architecture](https://v2.tauri.app/concept/architecture/) page and [github.com/tauri-apps/tauri](https://github.com/tauri-apps/tauri)). Because the WebView is not bundled, bundle size is a fraction of Electron's and the app inherits OS WebView security patches automatically. The trade-off, noted in Tauri's own docs, is potential per-OS rendering inconsistency (WebView2/WKWebView/WebKitGTK do not implement standards identically).

**Security model.** Tauri's [Security overview](https://v2.tauri.app/security/) frames the IPC layer as the bridge between two trust groups: core/plugins (full system access) and WebView code (only what is explicitly exposed). The v2 architecture was independently audited by Radically Open Security during beta/RC, funded via NLNet/NGI. For a wallet host this is decisive: treat the frontend as hostile and keep all sensitive logic in Rust.

**Commands and the IPC bridge.** Rust functions annotated `#[tauri::command]` are exposed to the frontend and invoked via `invoke()` from `@tauri-apps/api`. Typed data crosses the boundary through serde serialization (v2 also supports raw byte payloads to avoid JSON overhead for large transfers, per the [Tauri 2.0 release notes](https://v2.tauri.app/blog/tauri-20/)). See [Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/). Note the documented constraint: `tauri::generate_handler!` must receive all commands in a single call.

**Events and channels for real-time data.** The [event system](https://v2.tauri.app/develop/calling-frontend/) provides `app.emit`/`emit_to`/`emit_filter` on the Rust side (via the `Emitter` trait) and `listen`/`once` on the JS side. Tauri's docs are explicit that the event system is for small, bidirectional messages and "is not designed for low latency or high throughput situations"; for streaming (download progress, child-process output, and — relevant here — high-frequency Bitnodes snapshot deltas or live balances) Tauri recommends **Channels**, which are fast and ordered. PARSEC should use events for discrete state changes (a new snapshot arrived) and Channels for high-throughput streams.

**State management.** Tauri's [State Management](https://v2.tauri.app/develop/state-management/) uses the `Manager` API: `app.manage(...)` registers managed state, and commands receive it via the `State<'_, T>` guard. Because Rust forbids shared mutation, interior mutability (e.g. `std::sync::Mutex` or `tokio::sync::Mutex`) is required; the docs warn that using the wrong type for the `State` parameter yields a runtime panic rather than a compile error, so a type alias is recommended. PARSEC would manage the Bitnodes client, the geodesy engine, and the live wallet-connection registry as managed state.

**Plugins.** v2 moved most core APIs into independently-versioned plugins (filesystem, HTTP client, dialog, notification, store, SQL, stronghold, updater, websocket, etc.), each shipping a Rust crate, a JS package, and permission identifiers. Relevant to PARSEC: **tauri-plugin-http** (outbound HTTP with a URL-scoped allowlist), **tauri-plugin-store** (key-value persistence for UI/session state), and **tauri-plugin-stronghold** (encrypted secret storage) — though for a non-custodial host, secrets are minimized by design. A recurring v2 pitfall documented widely is the three-file agreement requirement: a plugin must appear in `Cargo.toml`, be registered in `lib.rs`, AND be granted in a capability file, or calls fail with "not allowed by ACL."

**Capabilities/permissions ACL.** The [Capabilities](https://v2.tauri.app/security/capabilities/) and [Permissions](https://v2.tauri.app/security/permissions/) systems are the security boundary. **Permissions** are on/off toggles for individual commands; **scopes** are parameter validators (glob file paths, URL allowlists); **capabilities** attach permission+scope sets to specific windows/webviews (by label, not title). Capability files live in `src-tauri/capabilities/` as JSON/TOML and are auto-enabled. For PARSEC, the practical guidance is to start broad (`core:default`) in development then narrow aggressively before release, scoping `http` to only `https://bitnodes.io/*` and the specific RPC endpoints needed.

**Bundle, signing, updater, cross-platform.** The [updater plugin](https://v2.tauri.app/plugin/updater/) signs update artifacts with a keypair generated by `tauri signer generate`; on Linux it produces a `.tar.gz` from the AppImage. For Podman-friendly Linux workflows, the bundler emits `.deb` and `.AppImage` (and `.rpm`) — note that `.deb`/`.AppImage` can only be built on Linux (no cross-compile), and you must build on the **oldest glibc base** you intend to support (Tauri docs recommend Ubuntu 22.04 / Debian 12 as the WebKitGTK 4.1 baseline for v2). AppImage GPG signing is supported but AppImage does not self-validate, so publish your key over TLS. Targets are configured via `bundle.targets` or the `--bundles` flag.

### 2. PARSEC as a multi-wallet host/container

**The "wallet of wallets" pattern.** PARSEC is a dapp host, not a custodian. Architecturally it maintains a registry of *connections* to external wallets, each abstracted behind a common interface, and routes signing/transaction requests to whichever wallet owns the relevant account. This mirrors how aggregators work and is directly analogous to the Solana [wallet-adapter](https://github.com/anza-xyz/wallet-adapter)'s modular design, where a `WalletProvider` holds an array of adapters and a uniform set of methods (`connect`, `signTransaction`, `signMessage`) abstracts heterogeneous wallets.

**WalletConnect v2 / Reown AppKit.** [Reown AppKit](https://github.com/reown-com/appkit) (formerly WalletConnect's Web3Modal) is the dapp-side toolkit; **WalletKit** is the wallet side. The session model uses CAIP-2 namespaces: a proposal specifies `chains` (e.g. `["eip155:1","eip155:42161"]`), `methods` (`personal_sign`, `eth_sendTransaction`), `events` (`chainChanged`, `accountsChanged`), and `accounts` in CAIP-10 form (`eip155:1:0x...`). Reown AppKit supports 600+ wallets via the WalletConnect Network; per Business Wire (15 January 2025), WalletKit is "Used by over 600 wallets, including Trust Wallet, OKX Wallet, Binance Web3 Wallet, Bitget Wallet, Crypto.com Onchain, and Fireblocks," and the network has facilitated "over 220 million connections and over 35 million unique active wallets." See [docs.reown.com](https://docs.reown.com/). **Licensing caveat:** the AppKit SDK ships under the *Reown AppKit Community License*, not Apache-2.0 — a compliance point PARSEC must evaluate against its Apache-2.0 posture; the underlying WalletConnect protocol and `@walletconnect/*` utilities are separately licensed and the raw protocol can be used without AppKit's UI layer.

**EIP-6963 + EIP-1193.** [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) standardizes the Ethereum Provider JS API (`request({method, params})`). [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) ("Multi Injected Provider Discovery") fixes the `window.ethereum` race condition by having wallets announce themselves via window events (`eip6963:announceProvider`) carrying an `EIP6963ProviderDetail` (`info` with `uuid`/`name`/`icon`/`rdns`, plus the `provider`). PARSEC's host layer should subscribe to these events — the [`mipd`](https://github.com/wevm/mipd) library provides a typed store (`createStore().subscribe(...)`, `findProvider({rdns})`) and is the pragmatic implementation path in a React/TS app.

**Enveloping BANKON: the adapter pattern.** Define a single chain-agnostic `WalletAdapter` interface (TypeScript on the frontend, mirrored by Rust types where signing flows touch the core). Each concrete adapter — an EIP-6963/EIP-1193 EVM adapter, a WalletConnect adapter, a Bitcoin adapter, an Algorand adapter, and the **BANKON adapter** — implements `connect`, `disconnect`, `getAccounts`, `signMessage`, `signTransaction`/`sendTransaction`, and emits account/chain change events. BANKON (a private repository, treated here as a proprietary internal project) connects as *one* such adapter; the host neither sees nor stores its keys. This is the structural inversion from the prior Qt design: rather than BANKON being the application, BANKON becomes a pluggable participant inside PARSEC's host registry.

**Security for a host wallet.** Never custody connected wallets' keys; scope permissions per connection; validate every CAIP-2/CAIP-10 identifier; bind requested capabilities to the minimum namespace set; and keep all cryptographic verification in Rust (Tauri's own v1 guidance is explicit: "DO NOT trust the results of cryptography using private keys in the Webview"). Treat session state as sensitive and persist only what is necessary.

### 3. Embedding the Bitnodes 3D globe (CesiumJS primary)

**Bitnodes data source.** The [Bitnodes API](https://bitnodes.io/api/) exposes `GET https://bitnodes.io/api/v1/snapshots/latest/`. A snapshot returns `timestamp`, `total_nodes`, `latest_height`, and a `nodes` map keyed by `address:port`, each value an array `[protocol_version, user_agent, connected_since, services, height, hostname, city, country, latitude, longitude, timezone, asn, organization_name]`. The API docs show a representative snapshot (timestamp 1764325181, height 925545) reporting `total_nodes` of 23,877 (an adjacent snapshot reports 24,032). New snapshots are produced about every 10 minutes, so polling more often than that is wasteful. **Rate limits** are documented on the API page; PARSEC must respect `ratelimit-remaining` and back off on HTTP 429 with the `retry-after` header. The crawler itself is [ayeowch/bitnodes](https://github.com/ayeowch/bitnodes).

**CesiumJS as the featured globe.** [CesiumJS](https://github.com/CesiumGS/cesium) (Apache-2.0) models the WGS84 ellipsoid exactly and is the scientifically correct choice. In React, use the [resium](https://github.com/reearth/resium) bindings (MIT). The build challenge is that Cesium ships static assets (Workers, Assets, Widgets) that Vite does not handle by default; the canonical fix is [vite-plugin-cesium](https://github.com/nshen/vite-plugin-cesium) (`plugins: [cesium()]`), which copies the static assets and sets `CESIUM_BASE_URL`. Cesium's own [Vite/webpack guide](https://cesium.com/blog/2024/02/13/configuring-vite-or-webpack-for-cesiumjs/) documents the manual approach (copy the four asset directories, define `window.CESIUM_BASE_URL`). Note that the `vite-plugin-cesium` repo appears to have slowed in maintenance, so PARSEC should be prepared to fall back to Cesium's documented manual Vite configuration.

**Plotting nodes and arcs.** Per the [Cesium Entity API](https://cesium.com/learn/cesiumjs-learn/cesiumjs-creating-entities/), each reachable node becomes an entity with `position: Cesium.Cartesian3.fromDegrees(lon, lat)` rendered as a `point` (lightweight) or `billboard` (icon). Peer relationships become `polyline` entities; for true great-circle arcs set `polyline.arcType = Cesium.ArcType.GEODESIC` and tune `granularity`, with `material` options including `PolylineGlowMaterialProperty` for the characteristic glowing-arc look. Cesium's `EllipsoidGeodesic` (with `surfaceDistance`) is available client-side, but PARSEC's design pushes that computation to Rust (below).

**Performance.** Bitnodes-scale rendering (tens of thousands of points/labels) is feasible but labels and billboards carry overhead; Cesium's own [Entity API Performance](https://cesium.com/blog/2018/06/21/entity-api-performance/) post documents that points are highly optimized while thousands of labels/billboards consume significant resources, and recommends batching/skipping unchanged entities (and, for very large sets, 3D Tiles). Practical guidance for PARSEC: render nodes as `point` primitives (not billboards) at full scale; cap simultaneously-drawn arcs (e.g. only the selected node's peers, or a sampled subset); use Cesium's `requestRenderMode` to render only on change; and offload all coordinate math to Rust.

**Lighter alternative — Three.js / react-globe.gl.** [react-globe.gl](https://github.com/vasturiano/react-globe.gl) wraps [three-globe](https://github.com/vasturiano/three-globe)/[globe.gl](https://github.com/vasturiano/globe.gl) and exposes declarative `pointsData`/`arcsData` layers with accessors (`pointLat`, `pointLng`, `arcStartLat`, `arcColor`, `arcDashAnimateTime`, etc.). It renders a spherical (not WGS84-ellipsoidal) globe, is GPU-friendly, and is far simpler to wire into React — at the cost of geodetic exactness. It is the right choice if PARSEC wants a fast, attractive network view without scientific precision; CesiumJS is the right choice when the globe must be WGS84-accurate.

**CSP for WebGL/Cesium in Tauri.** Cesium uses Web Workers and (optionally) WASM, and fetches imagery tiles. Tauri's [CSP](https://v2.tauri.app/security/csp/) is set in `tauri.conf.json > app > security > csp`; Tauri auto-injects nonces/hashes for bundled assets. PARSEC must extend `connect-src` to the Bitnodes API and any imagery provider, `worker-src`/`script-src` to allow Cesium's workers (`blob:`), `img-src` to allow `blob: data:` tiles, and include `'wasm-unsafe-eval'` in `script-src` if WASM is used. Keep the policy as tight as possible per Tauri's guidance.

### 4. The Rust backend data + geodesy core (canonical WGS84 in Rust)

**Bitnodes client.** A `reqwest` + `tokio` async client polls `snapshots/latest/`, deserializes into serde structs (the positional `nodes` arrays map cleanly to a typed struct via custom deserialization), enforces the 10-minute cadence, and honors rate-limit headers. The client lives as Tauri managed state; on each new snapshot it computes derived geometry and emits an event (or streams over a Channel) to the frontend.

**Geodesy as single source of truth.** Use [`geographiclib-rs`](https://github.com/georust/geographiclib-rs) — a pure-Rust port of Karney's geodesic algorithms, validated against Charles Karney's authoritative GeodTest suite, exposing `Geodesic::wgs84()` (which per the georust docs encodes "Standard Earth ellipsoid (a=6378137.0 m, f=1/298.257223563)") and the `DirectGeodesic`/`InverseGeodesic` traits plus `GeodesicLine` for sampling many points along one geodesic without recomputation. The project's README states "the Rust implementation is 10-50% slower than the c bindings" (published benchmarks: inverse C wrapper 45.1 µs vs Rust impl 67.8 µs; direct C wrapper 24.1 µs vs Rust impl 26.2 µs) — irrelevant at Bitnodes scale and well worth the no-FFI, type-safe integration. The broader [GeoRust](https://github.com/georust) ecosystem (`geo`, `geo-types`, `proj`) is available if richer geometry is needed; `geo` itself offers Karney-based `Geodesic` measures.

**Geodetic → ECEF in Rust.** For placing nodes in 3D Cartesian space, PARSEC computes ECEF directly from the WGS84 constants. The prime vertical radius of curvature is `N = a / sqrt(1 − e² · sin²φ)` with `e² = 2f − f² ≈ 0.00669437999014`, then:
```
X = (N + h)·cosφ·cosλ
Y = (N + h)·cosφ·sinλ
Z = (N·(1 − e²) + h)·sinφ
```
(`a = 6378137.0`, `f = 1/298.257223563`). This is a textbook, well-sourced transform. Geodesic arcs are produced by stepping a `GeodesicLine` from node A to node B at a chosen `granularity`, yielding intermediate (lat, lon) samples that are either sent as lat/lon (Cesium re-projects) or pre-converted to ECEF for Three.js. **Why in Rust:** one canonical implementation, no drift between renderers, type safety, and performance; the frontend becomes a pure renderer that receives precomputed coordinates.

**Typed IPC contract.** Use serde across the boundary and generate TypeScript types from Rust to keep the contract honest. [`ts-rs`](https://github.com/Aleph-Alpha/ts-rs) generates per-type `.ts` from `#[derive(TS)]`. [Specta](https://github.com/specta-rs/specta) + [`tauri-specta`](https://github.com/specta-rs/tauri-specta) go further, generating a fully-typed command/event client (including function signatures), so a change to a Rust command signature breaks the frontend build immediately. For PARSEC's many typed payloads (snapshots, node records, arc point arrays, wallet-connection state), `tauri-specta` is the recommended choice; [TauRPC](https://github.com/MatsDK/TauRPC) is an alternative offering a trait-based, bidirectional typed IPC layer built on Specta.

**Async/threading.** `tokio` drives non-blocking polling and any RPC calls; long computations run on the async runtime or a spawned task so the Core never blocks UI responsiveness. Emit progress over a Channel for any long operation, per Tauri's streaming guidance.

### 5. Wallet / chain integration in the Tauri context

**EVM (alloy + Foundry).** Use [alloy](https://github.com/alloy-rs/alloy) (the successor to the now-deprecated ethers-rs, by Paradigm) for all EVM work in Rust: `ProviderBuilder` for network-aware providers, and the `sol!` macro with `#[sol(rpc)]` to generate type-safe contract bindings (read example: `ERC20::new(addr, provider).balanceOf(owner).call().await?`). Contracts themselves are written and tested with **Foundry** as the canonical Solidity test framework, deployed **mainnet-only, with no admin keys and no upgradeable proxies** per cypherpunk standards. alloy is network-generic (works across EVM L2s via the same interface), which suits a multi-chain host.

**Algorand (x402-avm + USDC).** Circle's official USDC on Algorand is **ASA asset ID `31566704`** on mainnet (confirmed by Circle's multi-chain USDC page at [circle.com/multi-chain-usdc/algorand](https://www.circle.com/multi-chain-usdc/algorand) and the Pera/AlgoExplorer explorers; testnet is `10458941`; 6 decimals; issued by Circle/Centre, created 4 September 2020). The **x402** payment protocol has been extended to the Algorand Virtual Machine through a collaboration between the **Algorand Foundation and GoPlausible**, which serves as the network's designated facilitator; the Algorand Foundation posted on X on **23 February 2026**: "x402 is now fully supported on Algorand. Spec merged with @coinbase. Facilitator live. Bazaar running. Tooling ready." The implementation ships as npm packages under the **`@x402-avm`** namespace (`@x402-avm/core`, `@x402-avm/avm`, plus framework adapters for express/hono/next), with the x402-avm constants defining `USDC_MAINNET_ASA_ID = 31566704`; documentation is hosted under [GoPlausible's repo](https://github.com/GoPlausible). For Rust-side Algorand work, the de-facto SDK is [`algonaut`](https://github.com/manuelmauro/algonaut) (algod/kmd/indexer clients, transaction construction including ASA transfers, ABI), but it is a community-maintained "work in progress" — Algorand officially supports only JS, Python, Java, and Go SDKs, treating Rust as community-only. PARSEC should flag this: where Rust Algorand support is thin, either pin `algonaut` carefully or bridge via the supported x402-avm TypeScript/Python packages in the frontend/sidecar.

**Bitcoin Core anchor.** [`bitcoincore-rpc`](https://github.com/rust-bitcoin/rust-bitcoincore-rpc) (with `bitcoincore-rpc-json`) from the rust-bitcoin org is the canonical client for Bitcoin Core's JSON-RPC. Use cookie auth (`Auth::CookieFile`) over user/pass where possible. This anchor serves a dual role: it is the verification/diagnostic backend (querying block height, chain state, mempool) and it can corroborate the Bitnodes globe view against a node PARSEC actually trusts. The broader [rust-bitcoin](https://github.com/rust-bitcoin) crate provides address/transaction primitives for the Bitcoin adapter.

**x402 in the dapp context.** x402 (Coinbase, now under the x402 Foundation co-governed with Cloudflare) revives HTTP 402: a server replies `402 Payment Required` with payment requirements; the client signs a stablecoin payment (USDC via EIP-3009 on EVM, or the AVM mechanism on Algorand), retries with the payment header, and a facilitator verifies/settles on-chain (see [github.com/coinbase/x402](https://github.com/coinbase/x402)). For PARSEC this is the natural mechanism if any premium data feed (e.g. a Bitnodes PRO tier or a paid RPC) is monetized per-request, and it dovetails with the Algorand USDC settlement path.

### 6. Synthesis, architecture, and roadmap

**Master architecture (layered).**
1. **PARSEC Tauri shell** — Rust Core process + React/TS (Vite) frontend in the OS WebView; capabilities ACL as the security boundary.
2. **Multi-wallet host layer** — EIP-6963 discovery (`mipd`) + EIP-1193 + WalletConnect/Reown AppKit sessions + custom adapters behind one `WalletAdapter` interface; BANKON is one adapter.
3. **Enveloped wallets** — BANKON and other EVM/Bitcoin/Algorand wallets, keys never custodied.
4. **Bitnodes globe diagnostic view** — CesiumJS (primary, WGS84-exact) or react-globe.gl (alternative), fed precomputed coordinates.
5. **Rust geodesy/data core** — `reqwest`/`tokio` Bitnodes client + `geographiclib-rs` geodesy; serde + `tauri-specta` typed IPC.
6. **Chain adapters (Rust crates)** — `alloy` (EVM, Foundry-tested contracts), `algonaut`/x402-avm (Algorand/USDC ASA 31566704), `bitcoincore-rpc` (Bitcoin Core anchor).

**Relationship to the prior Qt 6 / PySide6 design.** The Tauri pivot **deprecates Qt for the shell/UI layer**: Qt 6/PySide6 is replaced by the Tauri (Rust + React/TS) host. What carries over is conceptual, not code — the data model (Bitnodes ingestion), the geodesy approach (WGS84 as single source of truth, now canonically in Rust rather than Python), and the chain-anchor concepts. They do **not** need to coexist; Tauri becomes the single shell. Python (>=3.12) remains appropriate for out-of-band tooling, data analysis, and any sidecar that leverages the supported Algorand Python SDK or x402 Python packages, but it is no longer the desktop runtime.

**Recommended project structure (flat snake_case).**
```
parsec/
  src_tauri/                 # Rust core (Tauri default is src-tauri; user prefers snake_case)
    src/
      main.rs
      lib.rs
      bitnodes_client.rs     # reqwest/tokio poller
      geodesy.rs             # geographiclib-rs: ECEF + geodesic sampling
      wallet_host.rs         # connection registry + adapter routing
      chain_evm.rs           # alloy
      chain_algorand.rs      # algonaut / x402-avm bridge
      chain_bitcoin.rs       # bitcoincore-rpc anchor
    capabilities/
      default.json
    tauri.conf.json
    Cargo.toml
  src/                       # React + TS (Vite) frontend
    components/
      globe_view.tsx         # resium / CesiumJS
      wallet_panel.tsx
    adapters/
      wallet_adapter.ts      # unified interface
      adapter_eip6963.ts
      adapter_walletconnect.ts
      adapter_bankon.ts
    bindings.ts              # generated by tauri-specta
  contracts/                 # Foundry
    src/
    test/
    foundry.toml
  package.json
  vite.config.ts
```

**Recommended dependencies.**
- Rust: [`tauri`](https://github.com/tauri-apps/tauri) 2.x, [`tokio`](https://crates.io/crates/tokio), [`reqwest`](https://crates.io/crates/reqwest), [`serde`](https://serde.rs), [`geographiclib-rs`](https://crates.io/crates/geographiclib-rs), [`geo`](https://docs.rs/geo/), [`alloy`](https://crates.io/crates/alloy), [`bitcoincore-rpc`](https://crates.io/crates/bitcoincore-rpc), [`algonaut`](https://crates.io/crates/algonaut), [`specta`](https://crates.io/crates/specta)/[`tauri-specta`](https://github.com/specta-rs/tauri-specta).
- npm: [`react`](https://react.dev), `typescript`, [`vite`](https://vitejs.dev), [`@tauri-apps/api`](https://www.npmjs.com/package/@tauri-apps/api), [`cesium`](https://www.npmjs.com/package/cesium) + [`resium`](https://www.npmjs.com/package/resium) + [`vite-plugin-cesium`](https://www.npmjs.com/package/vite-plugin-cesium) (or [`react-globe.gl`](https://www.npmjs.com/package/react-globe.gl)), [`@reown/appkit`](https://github.com/reown-com/appkit), [`mipd`](https://github.com/wevm/mipd).

**Phased roadmap.**
- *Phase 0 — Skeleton.* Scaffold Tauri 2 + React/TS/Vite; lock capabilities to a minimal set; wire `tauri-specta` bindings generation.
- *Phase 1 — Data/geodesy core.* Rust Bitnodes client (rate-limited), `geographiclib-rs` geodesy, ECEF/arc sampling, event/Channel push to frontend.
- *Phase 2 — Globe.* CesiumJS via resium + vite-plugin-cesium; plot points; render selected-node geodesic arcs; tune performance (point primitives, requestRenderMode).
- *Phase 3 — Wallet host.* Unified adapter interface; EIP-6963 (`mipd`) + WalletConnect/AppKit; **BANKON adapter**; per-connection permission scoping.
- *Phase 4 — Chain adapters.* alloy + Foundry contracts (mainnet, no admin keys); bitcoincore-rpc anchor; Algorand/x402-avm USDC path.
- *Phase 5 — Hardening & distribution.* Tighten CSP and ACL; signed updater; `.deb`/`.AppImage` builds in a Podman/CI pipeline on an old-glibc base.

**Security best practices.** Treat the WebView as untrusted; keep all crypto/verification in Rust; never custody connected wallets' keys; scope `http` to only Bitnodes + required RPCs; scope capabilities per window; set a strict CSP (with `'wasm-unsafe-eval'` and `blob:` worker-src only as Cesium requires); deploy contracts mainnet-only with no admin keys and no upgradeable proxies; license everything Apache-2.0 (auditing the Reown AppKit Community License as the one non-Apache dependency to evaluate).

---

## Recommendations

1. **Adopt Tauri 2.x now as the single shell and formally retire the Qt 6/PySide6 design** for the desktop runtime. Threshold to revisit: only reconsider Qt if you hit a hard requirement for pixel-identical cross-OS rendering or a native capability with no WebView/plugin path — neither applies to a wallet + globe app.
2. **Make Rust the canonical home of WGS84 geodesy** via `geographiclib-rs`, exposing precomputed ECEF/arc points over typed IPC. This eliminates renderer drift and lets you swap CesiumJS ↔ react-globe.gl without touching the math.
3. **Ship CesiumJS as the featured globe but keep react-globe.gl behind a feature flag.** If you measure frame-time problems above ~10k simultaneously-drawn arcs even after point-primitive + requestRenderMode optimization, switch the default to react-globe.gl for the network-health view.
4. **Build the host layer around a single `WalletAdapter` interface**, with EIP-6963/`mipd` and WalletConnect/AppKit as the first two adapters and BANKON as the third. This is the concrete realization of "enveloping."
5. **Resolve the two licensing/maintenance risks explicitly:** (a) evaluate the Reown AppKit Community License against your Apache-2.0 requirement — if it conflicts, use the raw `@walletconnect/*` protocol libraries and build your own connect UI; (b) pin `algonaut` to a tested version and isolate Algorand behind the adapter, or route Algorand/x402 through the officially-supported TypeScript/Python x402-avm packages in a sidecar.
6. **Respect Bitnodes limits as a first-class constraint:** poll at most every 10 minutes, honor `ratelimit-remaining`/`retry-after`, and consider a PRO key if higher cadence is ever required.

---

## Caveats

- **PARSEC and BANKON are private/proprietary projects.** This guide is built from general, publicly-documented architecture patterns; all internal specifics (BANKON's actual adapter surface, PARSEC's repo layout) are for the user to fill in.
- **The Algorand x402 mainnet date (23 February 2026)** is sourced from the Algorand Foundation's own X announcement and corroborated by a secondary ecosystem recap; the `algonaut` crate's exact last-commit/release currency was not pinned in research — verify on crates.io before depending on it, given its self-described "work in progress" status and Rust's community-only standing in the Algorand SDK ecosystem.
- **`vite-plugin-cesium` maintenance has reportedly slowed;** have Cesium's documented manual Vite asset configuration ready as a fallback.
- **Per-OS WebView differences are real** (WebView2 vs WKWebView vs WebKitGTK); test the Cesium/WebGL path on all three targets.
- **Forward-looking or vendor-sourced ecosystem figures** (x402 transaction volumes, AppKit's 600+ wallet / 220M connection / 35M active-wallet counts) come from vendor/press sources and should be treated as directional, not independently audited.

---

### Primary source references

**Tauri:** [tauri.app](https://tauri.app) · [Architecture](https://v2.tauri.app/concept/architecture/) · [Process Model](https://v2.tauri.app/concept/process-model/) · [Security](https://v2.tauri.app/security/) · [Capabilities](https://v2.tauri.app/security/capabilities/) · [Permissions](https://v2.tauri.app/security/permissions/) · [CSP](https://v2.tauri.app/security/csp/) · [Calling Rust](https://v2.tauri.app/develop/calling-rust/) · [Calling Frontend](https://v2.tauri.app/develop/calling-frontend/) · [State Management](https://v2.tauri.app/develop/state-management/) · [Updater](https://v2.tauri.app/plugin/updater/) · [AppImage](https://v2.tauri.app/distribute/appimage/) · [github.com/tauri-apps/tauri](https://github.com/tauri-apps/tauri)
**Wallet host:** [reown-com/appkit](https://github.com/reown-com/appkit) · [docs.reown.com](https://docs.reown.com/) · [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) · [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) · [wevm/mipd](https://github.com/wevm/mipd) · [anza-xyz/wallet-adapter](https://github.com/anza-xyz/wallet-adapter)
**Globe:** [CesiumGS/cesium](https://github.com/CesiumGS/cesium) · [reearth/resium](https://github.com/reearth/resium) · [nshen/vite-plugin-cesium](https://github.com/nshen/vite-plugin-cesium) · [Cesium Vite guide](https://cesium.com/blog/2024/02/13/configuring-vite-or-webpack-for-cesiumjs/) · [Entity API Performance](https://cesium.com/blog/2018/06/21/entity-api-performance/) · [vasturiano/react-globe.gl](https://github.com/vasturiano/react-globe.gl) · [vasturiano/three-globe](https://github.com/vasturiano/three-globe) · [globe.gl](https://globe.gl/)
**Data/geodesy:** [Bitnodes API](https://bitnodes.io/api/) · [ayeowch/bitnodes](https://github.com/ayeowch/bitnodes) · [georust/geographiclib-rs](https://github.com/georust/geographiclib-rs) · [georust](https://github.com/georust) · [geo docs](https://docs.rs/geo/) · [specta-rs/tauri-specta](https://github.com/specta-rs/tauri-specta) · [Aleph-Alpha/ts-rs](https://github.com/Aleph-Alpha/ts-rs)
**Chains:** [alloy-rs/alloy](https://github.com/alloy-rs/alloy) · [rust-bitcoin/rust-bitcoincore-rpc](https://github.com/rust-bitcoin/rust-bitcoincore-rpc) · [rust-bitcoin](https://github.com/rust-bitcoin) · [manuelmauro/algonaut](https://github.com/manuelmauro/algonaut) · [coinbase/x402](https://github.com/coinbase/x402) · [Circle USDC on Algorand](https://www.circle.com/multi-chain-usdc/algorand) · [GoPlausible](https://github.com/GoPlausible)