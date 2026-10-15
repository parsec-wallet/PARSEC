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

## Paid uploads and what they cost (0.1.3)

Items over Turbo's free limit can be paid three ways, and the upload screen prices all three
side by side, exactly (integer winston, winc and micro-USD; `lib/permaweb/storage-cost.ts`):

| Route | Priced from | Paid with |
|---|---|---|
| Arweave directly | `arweave.net/price/{bytes}` × the AR price | AR from an Arweave address |
| Turbo credits | `payment.ardrive.io/v1/price/bytes` × Turbo's `/v1/rates` | credits on the Arweave address |
| **Turbo over x402** | Turbo's rate per item, **at least $0.01 each**; the exact figure is Turbo's 402 quote | **USDC on Base, from this wallet** |

**Over x402** (`lib/arweave/turbo-x402.ts`), non-custodial: the person pays Turbo directly.
1. The BANKONx402 facilitation fee — 10 % of the x402 cost, at least $0.05 (`lib/bankon-fee.ts`) — is
   paid first, once, over x402 to `mindx.pythai.net/permaweb/fee`. mindX computes the fee itself
   from Turbo's public prices; PARSEC refuses one that asks more than it computed.
2. Each paid item is POSTed to `upload.ardrive.io/v1/x402/data-item/signed`; Turbo answers 402,
   the PARSEC Keycore signs a USDC `transferWithAuthorization` on Base, Turbo settles and stores.
   Every payment is checked before signing — USDC, Base, and within the budget shown on screen
   (the estimate plus a quarter, plus a cent) — even under an auto-approve cap.
3. Free items still go the free way; Turbo's receipt must name the id that was signed.

Measured 2026-10-01 for 1 MB: Arweave direct ≈ $0.056 (AR $4.26), Turbo credits ≈ $0.081,
Turbo x402 $0.0828.

## The key that owns the name uploads to it (0.3.5)

A name, its ARIO and its Turbo credits all belong to one **Solana** key. Since 0.3.5 that key also
signs the upload, so nothing has to be moved between keys:

| Step | What happens | Where |
|---|---|---|
| Sign | ANS-104 **signature type 4**: ed25519 over the ASCII hex of the 48-byte deep-hash, in the PARSEC Keycore (`chain_sol_sign`, one approval for the batch) | `ans104.ts` `solanaSigningMessage`, `turbo.ts` `solanaUploadSignerFor` |
| Post | `POST upload.ardrive.io/v1/tx/solana`. The path comes from the item's own signature type (`turboTokenFor`) | `turbo.ts` `postDataItem` |
| Pay | Turbo charges the Solana address: its free allowance first, then its credits (`GET payment.ardrive.io/v1/account/balance/solana?address=`) | `turbo.ts` `getTurboBalanceWinc` |
| Point | Same key, `setRecord` on the ANT | `name-controller.ts` |

The bytes match `@dha-team/arbundles` `HexSolanaSigner`, the signer `@ardrive/turbo-sdk` uses for
token `solana`. The test (`__tests__/ans104-solana.test.ts`) builds an item with our code and
verifies it with arbundles, and shows that a signature over the raw hash is refused. A type-4 item
is 928 bytes lighter than an Arweave-signed one (64 + 32 bytes against 512 + 512).

Upstream does the same. **ar.io Deploy** (`@ar.io/deploy` v2.1.1, 2026-10-09; listed under "Build
with the protocol" at <https://ar.io/products/>) uploads with `--sig-type solana`, and keeps the
**upload key** and the **ArNS authority key** as two keys that may be the same Solana wallet. PARSEC
holds both in the vault and signs in the Keycore instead of reading a `DEPLOY_KEY` or a `.json`
wallet file.

**Owner wallet `Dhma3U…ymvMg`, 2026-10-15:** 1,518,694,833,784 winc ≈ 111 MiB of credits; 0.0454 SOL;
owns spintrade · bankon · deltaverse · dreamodus, all four still on ar.io's placeholder.

### "CID" — what the Target ID field wants

ArNS does not use IPFS. The field that other tools call a CID is the **Arweave id**: 43 characters
of base64url (`A–Z a–z 0–9 - _`), returned when an upload is signed. Point a name at a **manifest**
id to serve a folder (`index.html` at the root), or at a single file's id. An IPFS CID (`bafy…`,
`Qm…`) will not resolve. The id names bytes that never change. The name is a pointer the owner
can move, so the permanent link is `ar://<id>` and the friendly one is `ar://<name>`.

### Undernames in bulk, and the BANKON delivery fee

ar.io's console sells undername slots up to 50 at a time. PARSEC's name screen offers a slider to
**4096** with presets 10 · 50 · 512 · 4096 and **Max**, which is as many as the owner's ARIO covers.
The price is linear per slot, read live (`getTokenCost({intent:'Increase-Undername-Limit'})`):
**17.437772 ARIO a slot** on 2026-10-15, so 4096 slots = 71,425.114112 ARIO. The quote does not cap
the quantity (20,000 still priced).

The BANKON delivery fee is **φ% = 1.618033988749894848 %**, the fraction 0.01618033988749894848,
the same digits as THRUST `PhiFee.sol`. `lib/names/undername-plan.ts` computes it as BigInt
`cost × 1618033988749894848 / 10^20`. The fee is a terminating decimal, so it is shown **exactly**
(for 4096 slots, 1155.68262283555763746400894976 ARIO-equivalent). The one cut is the paying
token's base unit, and that cut truncates. It is distinct from the BANKONx402 upload facilitation
fee (10 %, min $0.05, `lib/bankon-fee.ts`). 0.3.5 shows it but does not collect it; the rail to
bankon.eth is still to be chosen.

## Not built yet

- **BANKON-delivered purchases** (one x402 payment to BANKON, which performs the Turbo upload or
  the ArNS purchase and delivers the result) need BANKON-held keys and funded floats on the
  server. Not built: the non-custodial route above is the current design.
- **Wayfinder routing.** Verification asks a fixed gateway list; ranking gateways by the ar.io
  registry or `/ar-io/peers` is next.
- **Undername uploads.** The upload hand-off fills the root target; the undername form still takes a
  pasted id (0.3.6).
- **Collecting the φ delivery fee** to bankon.eth (rail not chosen).
- **Permanence tags (THOT).** Items carry `Content-Type` and `App-Name: PARSEC` only.
