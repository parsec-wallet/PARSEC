# Permaweb module — ar.io and Arweave inside the wallet

> The Solana-era ar.io surface (names, gateway operation, the ARIO bridge) plus in-wallet uploads
> to Arweave. Registered once through `src/lib/permaweb/module.ts` (`registerModule`, tier
> `agenticplace`). Every file is on the [Arweave & ar.io source map](../arweave-ario-map.md);
> upstream sources are in [`../reference/permaweb/`](../reference/permaweb/README.md).
> Written 2026-09-10.

## What it does

| Route | View | What a participant does there |
|---|---|---|
| `permaweb-desk` | `views/permaweb-desk.ts` | See the operator wallet's ARIO, SOL and gateway status; jump to everything below |
| `permaweb-upload` | `views/permaweb-upload.ts` | **Put a file or a whole site on Arweave, verify it, point a name at it** |
| `permaweb-bridge` | `views/permaweb-bridge.ts` | Burn ARIO on Base to receive it on Solana |
| `permaweb-gateway-join` | `views/permaweb-gateway-join.ts` | Preflight and join the ar.io gateway registry (20,000 ARIO) |

Names themselves are run by the namespace views (`name-hub`, `name-controller`), which now have an
**Upload a file or site** button next to *Point the name at* — the uploaded id comes back
pre-filled.

## Upload → verify → point, end to end

```
 choose files / folder ──▶ planUpload()          exact signed sizes, free vs credits, manifest
                           (arweave/turbo.ts)    ids are 43 chars, so even the manifest is exact
        arm: "public and permanent" ──▶ uploadSignerFor()
                           desktop: deep-hash → Rust chain_ar_sign → signature (key stays in vault)
                           browser: vault JWK in WebCrypto, zeroed after (no Rust in the web build)
        runUpload() ──▶ POST upload.ardrive.io/v1/tx/arweave   one item at a time, then the manifest
                         refuses any receipt whose id is not the id we signed
        verifyUpload() ──▶ GET <gateway>/raw/<id>, SHA-256 here, compare with the bytes we signed
                           (permaweb/verify.ts — Wayfinder's HashVerificationStrategy, zero-dep)
        "Point a name at this" ──▶ handoff.ts ──▶ name-controller, id pre-filled
```

### The pieces

| File | Role |
|---|---|
| `src/lib/arweave/ans104.ts` | `signDataItemWith(input, signer)` — the external-signer seam; `estimateDataItemSize()` — exact size before signing. `signDataItem` now delegates to the seam, unchanged in behaviour |
| `src/lib/arweave/turbo.ts` | Turbo info / price / post, the per-platform signer, `planUpload`, `runUpload` |
| `src/lib/arweave/manifest.ts` | `arweave/paths` 0.2.0 manifests (index + fallback), path normalization, Content-Type guessing |
| `src/lib/permaweb/verify.ts` | Per-gateway digest checks: `match` / `mismatch` / `pending` / `unknown`, and one summary word |
| `src/lib/permaweb/handoff.ts` | One-shot sessionStorage hand-off between the upload view and the name controller |
| `src/lib/permaweb/module.ts` · `choices.ts` | The registration and its declared choices: `sign`, `external`, `device`, `optional-external` |

### Facts this is built on (read live 2026-09-10)

- **Upload endpoint** — `POST https://upload.ardrive.io/v1/tx/arweave`, raw signed item,
  `application/octet-stream`. From `@ardrive/turbo-sdk` `packages/turbo-sdk/src/common/upload.ts`
  (HTTP base `${url}/v1`, endpoint `/tx/${token}`, token defaults to `arweave`). Not exercised live:
  an upload is permanent.
- **Free tier** — `GET https://upload.ardrive.io/v1/info` → `freeUploadLimitBytes: 107520`
  (105 KiB, **not** the 100 KiB several docs still print), lifetime 10 MiB. It counts the whole
  signed item, tags and headers included. The view reads it live and says when it fell back.
- **Price** — `GET https://payment.ardrive.io/v1/price/bytes/<n>` → `{"winc": "…"}`; 1 KiB was
  20,541,086 winc, 200 KiB 2,600,641,213 winc. Shown as an estimate, exact `bigint` throughout.
- **Digest** — `x-ar-io-digest` is base64url(SHA-256(body)); `content-digest` carries the same hash
  in RFC 9530 base64. Recomputed on toon.ar.io: `HfPly1g-GhFMYGp6pI4ehiXTerycgZ2UOuwuyoSBLdo`
  over 93,089 bytes.
- **Gateways** — `turbo-gateway.com/raw/<id>`: 200, digest header, open CORS. `ar.io/raw/<id>`:
  404. `permagate.io`: 502 at the time. Hence the rule below.

### Rules the code keeps

- **Pending is not failure.** A 404 right after an upload is `pending`; an unreachable gateway is
  `unknown`. Only a hash that differs from the bytes we signed is `mismatch` — and one mismatch
  outranks any number of matches, and disables *Point a name at this*.
- **The gateway's own `x-ar-io-verified` is recorded, never trusted.** Verification is our hash
  against our bytes.
- **The id is ours.** `runUpload` refuses a Turbo receipt whose id differs from the signed item's.
- **Nothing leaves the device before signing**, and signing needs the arming checkbox: Arweave is
  public and permanent, and the screen says so before the button enables.
- **No float in a value.** Prices are `bigint` winc, formatted with `money.ts`.

## Why not `@ardrive/turbo-sdk`

The same reason `ao.ts` replaces `@permaweb/aoconnect` and `ans104.ts` replaces `arbundles`: the
upload path needs two GETs and one POST, and the SDK brings a transport stack and its own signers —
including ones that would hold the key in JS. The cypherpunk4096 zero-dependency commitment
([`../cypherpunk4096.md`](../cypherpunk4096.md)) points the same way.

## CSP

`src-tauri/tauri.conf.json` `connect-src` gained the Turbo hosts (`upload.ardrive.io`,
`payment.ardrive.io`, `turbo-gateway.com`, `*.turbo-gateway.com`) and, in the same change, six
hosts existing code already called but the desktop CSP did not allow: `cu.ardrive.io` and
`mu.ao-testnet.xyz` (AO), `mainnet.base.org` (the bridge), `solana-rpc.publicnode.com` and the two
`wss://` Solana endpoints the Solana-era writes confirm over. Under the previous CSP those calls
would have been refused in the **packaged** desktop app (`tauri build`). Neither `tauri dev` nor
the web build shows this: Tauri 2 (2.6.2, `src/protocol/tauri.rs`) attaches the
`Content-Security-Policy` header only to assets it serves itself, and on desktop `tauri dev`
loads the Vite dev URL directly — confirmed 2026-09-10 when the dev window reached eight ar.io
gateway hosts that are nowhere in `connect-src`. **Test CSP changes against a `tauri build`.**

Known gap, not fixed here: Blue Pill diagnostics (`views/matrix.ts`) samples arbitrary gateway
hosts from `/ar-io/peers` and reads DeFiLlama, alternative.me and several EVM RPCs — none of
them in `connect-src`. In a packaged build those panels will read as unreachable. Allowing them
means either a host list that can never cover registry-chosen gateways, or a wider policy —
a security decision, left open.

Fixed in the same pass: that panel's Solana control-plane probe was hard-coded to
`api.mainnet-beta.solana.com`, which answers its batch with **HTTP 403 "Access forbidden"** — the
panel showed *unreachable* while the control plane was fine. It now uses the Permaweb Solana RPC
setting (`solana-rpc.publicnode.com` by default), which answers the same batch with both ar.io
programs and the ARIO mint (checked 2026-09-10).

## Not built yet

- **Paid uploads end to end.** Items over the free limit go through if the Arweave address holds
  Turbo credits; otherwise Turbo answers 402 and the view says so. Buying credits (fiat, tokens,
  x402 USDC) is not in the wallet.
- **Wayfinder routing.** Verification asks a fixed gateway list; ranking gateways by the ar.io
  registry or `/ar-io/peers` is next.
- **Undername uploads.** The upload hand-off fills the root target; the undername form still takes a
  pasted id.
- **Permanence tags (THOT).** Items carry `Content-Type` and `App-Name: Parsec` only.
