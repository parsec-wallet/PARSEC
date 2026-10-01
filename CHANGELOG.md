# Changelog

All notable changes to PARSEC Wallet. Versions follow `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json`, which move together.

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
