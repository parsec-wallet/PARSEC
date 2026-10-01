# Changelog

All notable changes to PARSEC Wallet. Versions follow `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json`, which move together.

## 0.1.3 — 2026-10-01

### Arweave and ar.io
- **Paid uploads over x402, from your own wallet.** Items over Turbo's free limit are paid
  per item in USDC on Base through Turbo's x402 endpoint, signed by the PARSEC Keycore — no
  Turbo credits needed, nobody holds your money. The BANKON facilitation fee (10 %, at least
  $0.05) is paid first, once, over x402; mindX computes it from Turbo's public prices and PARSEC
  refuses a fee above its own computation. Every payment is checked before signing — USDC, Base,
  and within the budget shown on screen — even under an auto-approve cap.
- **What an upload costs, every way, exactly.** The upload screen prices the paid items by
  Arweave directly (AR), Turbo credits and Turbo over x402 (with Turbo's one-cent minimum per
  item and the BANKON fee), in AR and dollars, with integer arithmetic rounded up.
- **ArNS prices read correctly.** Name costs showed the raw mARIO number labelled "ARIO" — a
  million times too large; the name controller divided as a float. They now show ARIO exactly,
  with its dollar value.

### x402
- **Version-1 servers hear their own network name** (`base`) in a payment, as Turbo expects;
  internally and towards v2 servers networks stay CAIP-2.
- **Base USDC signs as "USD Coin"** when a server leaves the EIP-712 name out — the token's
  on-chain name; the old "USDC" default made an invalid signature on Base mainnet.
- **"USD Coin" counts as a dollar** (quotes show USD and the auto-approve cap applies); **EURC no
  longer does** — it is pegged to the euro.

### Docs
- `docs/permaweb/README.md` documents paid uploads and the three routes;
  `docs/arweave-ario-map.md` is regenerated (179 files, none unmapped).

## 0.1.2 — 2026-10-01

### Android
- **Installs on phones with 16 KB memory pages** (recent flagships such as the Galaxy S26).
  The native library was linked for 4 KB pages and is loaded straight from the APK, which such
  a phone refuses ("App not installed"); it is now linked with 16 KB alignment, which also runs
  on 4 KB phones.
- **The PARSEC icon** on the home screen and in the app drawer, as an adaptive icon on the
  PARSEC navy; it showed the Tauri framework's default logo.
- **The dApp bridge does not run on a phone.** On Android every installed app shares the
  device's loopback address, so the bridge's protection (only this machine can reach it) does
  not hold; the frontend no longer starts it and the PARSEC Keycore refuses to.
- The full address is shown on the dashboard on a phone (a finger cannot hover), and
  notifications span the width of a phone screen.

### Security documentation
- `docs/security/threat-model.md` gains an **Android** section: shared loopback, screen
  capture (`FLAG_SECURE`), the clipboard, background timers, keyboards, the absent desktop-only
  defences, release signing, and what is still open (Android Keystore as a second factor).
- `SECURITY.md` brings the Android app into scope and publishes the release-signing
  certificate.

## 0.1.1 — 2026-10-01

### Android
- **PARSEC on Android (arm64).** The Tauri Android project (`src-tauri/gen/android`); TLS through
  rustls instead of the platform OpenSSL; the desktop shell (tray, window controls, start at login)
  compiled for desktop only. Release builds are signed with the PARSEC release key, which is kept
  outside the repository.
- **A capability set for phones** (`capabilities/mobile.json`). Before it, no capability applied on
  Android: app events were denied, so the dApp bridge never started and links could not open.
- **Back button** walks PARSEC's own history and then the dashboard, instead of quitting the app.
- **Links** to other sites open in the phone's browser, so the wallet never navigates away from
  itself (which reloaded and locked it).
- **Safe areas**: content no longer sits under the status bar or the gesture bar.
- **Keyboard**: the page lifts above the on-screen keyboard and brings the focused field into view.
- **Screens are private**: recovery phrases and keys stay out of the recent-apps preview,
  screenshots and screen recordings (`FLAG_SECURE`).
- **Auto-lock** is checked when the app returns to the foreground; a phone can hold timers back.

### Phones and narrow screens
- The section rail is a **Menu drawer** under 600px; the desktop title bar is never shown on a phone.
- Touch-sized controls (44px), 16px inputs, card grids that fit a 360px screen.
- **Recovery phrases typed on a phone keyboard** (first word capitalised, double spaces) are
  accepted; auto-capitalise and autocorrect are off on every phrase field.
- **Amounts** use the decimal keypad and accept a decimal comma (`1,5` is 1.5); an amount that could
  be read two ways (`1,000.5`) is refused rather than guessed.
- The Matrix landing draws at 1× and about 30 frames a second on a phone, and starts with the rain
  off when the system asks for reduced motion.
- **Copy** says "copied" only when it was; Mausoleum and pmVPN are not offered on a phone.

### Fixes
- **x402: an order's terms are checked even under an auto-approve cap.** A new `verify` option runs
  before anything is signed, always; the .algo/ArNS store payments and the BANKON fee use it, so a
  registry cannot redirect a capped payment to another payee or amount.
- **Store orders**: every order the registry returns is checked against what was shown (fee = 10 %,
  at least $0.05; total = price + fee; price, payout and buyer unchanged); after each payment the
  order is read back and "paid" is announced only when the registry says so; an order is never paid
  from a different account than the one it was placed for.
- **Store editor** reloads the reserved names, so updating a store can no longer put them on sale.
- **x402 price oracle**: a payment is never priced against the auto-approve cap with the fixed
  fallback ALGO price — only with a measured one; Vestige and the BANKON-discount indexer are now in
  the CSP, so both actually work.
- **SPINTRADE two-hop swaps**: price impact compounds correctly (it showed negative values); hop 2
  spends what hop 1 guaranteed, never the quoted amount; a failed second hop says the first one
  completed.
- **Algorand send** converts the amount to base units exactly (no floating point).
- The PARSEC Keycore's HTTP transport stops reading at its 8 MiB cap instead of buffering an
  unbounded body first.
- Mausoleum calls the vault through `lib/tomb.ts` (whose argument names were wrong and are fixed).
- Text from price and news feeds is rendered as text, never as HTML.
- Prices under a cent show their value (`$0.004`), not `$0.00`.
- The favicon is the PARSEC mark (it pointed at a missing file).
- `pnpm-lock.yaml` regenerated: it pinned Tauri's JS packages to 2.6/2.4 while the Rust crates are
  2.10/2.5, which would have failed the release build.
- The version is read from `package.json` at build time (`__APP_VERSION__`) everywhere the wallet
  names itself.

## 0.1.0 — 2026-10-01

First public release: desktop installers for macOS, Windows and Linux.
