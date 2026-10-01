# Name desk — web integration

How `bankon.pythai.net`, `agenticplace.pythai.net`, `mindx.pythai.net` and
`deltaverse.pythai.net` manage ar.io names with PARSEC holding the key.

Written 2026-08-28. Companion to `docs/parsec-connect.md` (the Algorand signing path this
extends) and `DeltaVerse/deploy/arns/README.md` (the CLI for CI and headless boxes).

## The shape of it

```
  a PYTHAI site                    PARSEC (localhost:9876)              ar.io / Solana
  ─────────────                    ───────────────────────              ──────────────
  read: HEAD name.ar.io ─────────────────────────────────────────────▶  x-arns-resolved-id
        (no wallet, works for every visitor)

  write: parsec_nameRequest ─────▶ renders the intent as a sentence
         {op, name, params}        user reads it, approves
                                   NamespaceAdapter builds + signs ───▶  ario-arns program
                                   vault key never leaves Rust
         result {id} ◀──────────── returns the adapter's result
```

**A site states an intent; it never sends transaction bytes.** That is the whole design.
A dApp asking "sign these 200 bytes" gives the user nothing to judge. A dApp asking
*"point deltaverse at `<id>`"* gives them a sentence, and PARSEC — not the page — decides
which transaction that sentence means. A hostile origin can ask for the wrong change, but it
cannot dress an arbitrary payload up as a name change, and it cannot ask for anything outside
the allowlist.

## Protocol

Method `parsec_nameRequest` over the existing Connect WebSocket
(`ws://127.0.0.1:9876/parsec/v1/connect/ws`).

```jsonc
{ "id": 1, "method": "parsec_nameRequest",
  "params": {
    "namespace": "solana-arns",          // solana-arns | arns | bankon
    "op": "set-undername",
    "name": "deltaverse",
    "params": { "undername": "docs", "transactionId": "<43 chars>", "ttlSeconds": 900 },
    "origin": "https://bankon.pythai.net"
  } }
```

Resolves with whatever the namespace adapter returned (usually `{ id }`), or a JSON-RPC error:

| code | meaning |
|---|---|
| 4001 | user rejected, or the wallet could not sign for that name |
| 4002 | timed out after 300 s waiting for approval |
| 4100 | wallet is locked |
| -32602 | bad parameters — unknown op, malformed name |

### Operations

The allowlist lives in `src-tauri/src/parsec_connect/mod.rs` (`ALLOWED_NAME_OPS`) and is
mirrored in `src/lib/names/intent.ts` and `apps/parsec-names/parsec-names.js`. All three must
agree; the Rust list is authoritative and is unit-tested.

| op | params | risk |
|---|---|---|
| `set-root` | `transactionId`, `ttlSeconds?` | routine |
| `set-undername` | `undername`, `transactionId`, `ttlSeconds?` | routine |
| `remove-undername` | `undername` | routine |
| `set-identity` | any of `nickname`, `ticker`, `description`, `keywords[]`, `logo` | elevated |
| `add-controller` | `controller` | elevated |
| `remove-controller` | `controller` | routine |
| `set-primary` | — | routine |

**Deliberately absent: `transfer`, `buy-name`, `extend-lease`.** Giving a name away, and
spending ARIO, stay inside the wallet where the user went looking for them. A web page cannot
initiate either, however compromised it is.

That exclusion is load-bearing for any future price-quoting endpoint: quoting is not spending.
See [TOON, x402 and the naming service](./integration/toon-naming-x402.md) — an endpoint may
answer `402` with a name's cost, but the purchase still terminates in the wallet's own approval
sheet, and this allowlist does not grow to meet it.

*Elevated* requests — handing another key ongoing write access, or changing the identity
others read — must be armed with a checkbox before the approve button enables. One deliberate
act before the one that signs.

## Using it from a site

Copy `apps/parsec-names/parsec-names.js` into the site (it has no dependencies and needs no
build step) and import it:

```js
import { ParsecNames, ParsecNotAvailable, isArweaveId } from '/vendor/parsec-names.js';

const pn = new ParsecNames();                 // namespace defaults to 'solana-arns'

// Reads are public — do these unconditionally, for every visitor.
const root = await pn.read('deltaverse');
if (ParsecNames.isPlaceholder(root.resolvedId)) showBanner('still ar.io’s placeholder');

// Writes need the wallet.
if (await pn.detect()) {
  try {
    await pn.setUndername('deltaverse', 'docs', manifestId, 900);
  } catch (e) {
    if (e instanceof ParsecNotAvailable) …      // wallet closed mid-flight
    else if (e.code === 4001) …                 // user said no
  }
}
```

`apps/parsec-names/index.html` is a working desk built on it: a completion checklist per name
(root pointed? each planned undername set?), inline validation, and a progress bar that reads
live from the gateways. Host it, or lift the pattern.

### The rule that makes it usable

**Read first, wallet second.** Every one of these pages should render the complete truth about
a name to a visitor with nothing installed — what it serves, whether that is still ar.io's
placeholder, which undernames are live. Only the *change* controls depend on PARSEC, and when
it is absent they disable with a sentence saying why rather than disappearing.

## Origins

The Connect server's CORS allowlist gates the HTTP endpoints a page uses to detect PARSEC.
The default is now the PYTHAI suite — `bankon`, `agenticplace`, `mindx`, `deltaverse`, `rage`,
and the apex — plus **any loopback origin on any port**, which the server allows for
development (`http(s)://localhost`, `127.0.0.1`, `[::1]`, with or without a port). It has to be
a predicate rather than a list: CORS origins match exactly, port included, so a fixed list can
never cover whichever port the dev server picked. `localhost.evil.com` does not match.
Defined twice and they must agree:

- `src-tauri/src/parsec_connect/commands.rs` — `connect_start`
- `src/lib/connect.ts` — `DEFAULT_CONNECT_ORIGINS`

A second, softer gate is in the approval dialog: `KNOWN_ORIGINS` in `src/lib/names/intent.ts`
labels a request from a recognised site by name ("BANKON"), and shows anything else as
**Unrecognised site** in red. That is presentation, not security — the CORS layer is the gate —
but it is what the user actually looks at.

### Mixed content

`http://localhost` is a *potentially trustworthy* origin, so Chrome and Firefox allow an HTTPS
page to reach it. **Safari is stricter and may block it.** This is why `detect()` has a short
timeout and never throws: a missing wallet must not stall the page. Never leave the UI in a
state that assumes a wallet is there.

## Per-site integration

| Site | What it should do |
|---|---|
| **bankon.pythai.net** | Host the desk. It is the portal for `bankon` and the natural home for the five planned undernames (`thot`, `inft`, `mindx`, `pythai`, `bankon`). |
| **agenticplace.pythai.net** | Already the default Connect origin and the Marketspace web mirror. Add "Manage this name" to any listing whose name the visitor owns — same SDK, `namespace: 'bankon'` for BANKON Names. |
| **mindx.pythai.net** | mindX publishes artifacts to Arweave. After an upload it has a fresh manifest id and wants a friendly name for it: call `setUndername('bankon', 'mindx', id)` to repoint `mindx_bankon` at the newest publication. This is the case the intent protocol was shaped for — an agent proposes, a human approves. |
| **deltaverse.pythai.net** | The apex stays with the login333 doorway; the desk manages the permanent copy and the wildcard undernames. |

## Testing the handshake

The protocol is covered end to end without a GUI:

```bash
cd src-tauri && cargo run --example connect_harness 9877   # the real server, headless
node apps/parsec-names/test/handshake.test.mjs             # the real SDK, as a site uses it
```

`examples/connect_harness.rs` runs the shipping `start_connect_server` with no Tauri app
handle, and replaces exactly one thing — the human pressing Approve — with a policy loop
(`rejectme` rejects, `lockme` locks the wallet, everything else approves). Every other hop is
production code: the JSON-RPC router, the op allowlist, name validation, the pending queue, the
approval channel, and the SDK the sites ship.

20 assertions, all passing as of 2026-08-28, and re-run three times against a single harness to
prove the suite is repeatable: detection, a public read with no wallet, three approved round
trips (~31 ms each), rejection surfacing as `ParsecRejected` with code 4001, the allowlist
refusing `transfer` and `buy-name`, a malformed name refused, an unknown method refused, and
the locked-wallet path returning 4100 before the request ever reaches the approval queue.

Two bugs were found by running it, not by reading it:

- **`capabilities` did not advertise `nameRequest`**, so a page had no way to feature-detect the
  method. Now listed in `/info`.
- **CORS rejected every localhost dev port.** The list held `http://localhost`,
  `http://127.0.0.1` and `http://localhost:3000`; origins match exactly including port, so
  Vite's `:5173` — the port this project itself uses — was blocked, despite a comment promising
  localhost always worked. Replaced with a tested predicate that accepts any loopback origin on
  any port and still rejects `localhost.evil.com`.

### What is still not proven

**The GUI leg.** The Tauri event reaching `connect-name-approve`, a person reading the sentence,
and the NamespaceAdapter putting a real signature on chain have not been run against a live
desktop wallet. The harness proves the protocol; it does not prove the dialog. Do one manual
pass against a name you do not mind repointing before wiring this into a production site.
