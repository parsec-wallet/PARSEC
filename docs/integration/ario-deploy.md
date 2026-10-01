# Permaweb deployment — `ario-deploy` vs `permaweb-deploy`

> **Reviewed:** 2026-08-30 · **Scope:** Parsec's own publishing path only.
> `ar-io-deploy` — <https://github.com/ar-io/ar-io-deploy> — MIT,
<!-- REUSE-IgnoreStart -->> © Permanent Data Solutions.<!-- REUSE-IgnoreEnd -->

## The finding

**The two tools have diverged into different name systems.** This is not a
version-bump decision; it is a choice of which naming network Parsec publishes
under.

| | `permaweb-deploy` (permaweb org) | `ario-deploy` (ar-io org) |
|---|---|---|
| Names | **"Permaweb Names"** — `--use-names --name <NAME>` | **ArNS** — `--arns-name`, `--undername` |
| Name authority key | **Arweave** (`--sig-type arweave` required) | **Solana** — *"Always a Solana key controlling the ArNS name"* |
| Upload payer | Arweave JWK (`DEPLOY_KEY`) | Arweave, Ethereum, Polygon, KYVE **or Solana** |
| Stack | — | oclif CLI, Turbo SDK, `@ar.io/sdk`, `@solana/kit` |
| Interfaces | CLI | CLI (`ario-deploy`), **GitHub Action**, direct-in-workflow |
| Extras | — | on-demand ARIO/Base-ETH top-up; local dedup cache (`.ario-deploy/transaction-cache.json`) |

Its own line: *"Deploy any folder to Arweave and point an ArNS name at it.
Permanent hosting, one command."*

## Where Parsec actually stands

Installed: **`permaweb-deploy@3.4.6`**, pinned `^3.4.0`. Latest is **5.0.0**
(published 2026-06-17, after the June 1 ARIO Solana snapshot). Parsec is **two
majors behind**, and the v3 flags it depends on are gone upstream:

```jsonc
// package.json — v3 flags, not present in v5
"deploy:permaweb":      "… permaweb-deploy deploy --arns-name pythai --ario-process mainnet --deploy-folder ./dist --ttl-seconds 3600",
"deploy:permaweb:txid": "… permaweb-deploy deploy --deploy-folder ./dist",
"deploy:resolver":      "… permaweb-deploy deploy --deploy-folder ./apps/bankon-resolver/dist",
```

v5 replaced `--arns-name` / `--ario-process` with `--use-names --name <NAME>`
and requires `--sig-type arweave`. **The scripts work today only because the
`^3.4.0` range keeps us on v3.** A careless `npm update` breaks publishing.

## Why `ario-deploy` is the better fit for Parsec

Not novelty — alignment with what Parsec already is:

1. **Parsec's ArNS work is already Solana-era.** `src/lib/arweave/solana-arns-client.ts`
   and the `solana-arns` NamespaceAdapter target the `ario-arns` program and
   Metaplex-Core ANTs. `ario-deploy`'s Solana-key authority is the same model;
   `permaweb-deploy` v5's Arweave-signed "Permaweb Names" is a different one.
2. **The dependencies are already present.** `@ar.io/sdk` and `@solana/kit` are
   in `package.json` today — the exact SDKs `ario-deploy` is built on. Adopting
   it adds a devDependency, not a new ecosystem.
3. **Undernames are first-class.** `--undername` matters directly: the BANKON
   undername map (`<label>_<name>.<gateway>`, `label + name <= 63`) is already
   specified in `bankon-node-v6/permawebos-integration/parsec-gateway/UNDERNAMES.md`.
4. **A GitHub Action exists**, and the sibling repos already deploy that way —
   `spintrade/deploy.yml` and `deltaverse/deploy.yml` run `permaweb-deploy` on
   push using a **controller** key, owner kept cold. Same posture, better tool.
5. **Dedup cache** cuts repeat upload cost on a wallet bundle that is mostly
   unchanged chunks between releases.

## What this does *not* change

Parsec's runtime is untouched. This is a **devDependency and a CI concern**:
the wallet still builds to a Tauri-free `dist/` and is served from Arweave. No
frontend dependency, no bundle change, nothing on the first-paint path.

## Cautions

1. **Decide the naming network deliberately.** `pythai`, `bankon`, `deltaverse`
   and `spintrade` are live names with real ARIO spent on them. Confirm which
   system each is registered under **before** switching tools — publishing with
   the wrong one will not update the name you think it will.
2. **Two keys, two roles.** Upload payer and ArNS authority are separate.
   Keep the **owner key cold** and use a **controller** key in CI, exactly as
   the sibling `deploy.yml` files already do.
3. **Do not put a deploy key in the wallet.** This is maintainer tooling. It
   belongs in CI secrets and the operator's environment — never in `src/`,
   never in the vault, never in a view.
4. **On-demand top-up spends real value.** `ario-deploy` can auto-convert ARIO
   or Base-ETH to Turbo credits. Set an explicit spending limit; do not let a
   CI run decide how much ARIO to spend. The treasury has finite ARIO.
5. **Pin the version.** The lesson of being two majors behind on a tool whose
   flags changed underneath us: pin exactly and upgrade deliberately.
6. **`404.html` fallback.** All three current scripts copy `index.html` to
   `404.html` for SPA routing. Verify `ario-deploy`'s SPA fallback detection
   covers this before dropping the copy step.

## Recommended sequence

1. **Confirm the naming network** for `pythai` (the wallet), the BANKON
   resolver SPA, and the undername map. This is a fact-finding step, not a code
   change, and everything else depends on its answer.
2. **Pin `permaweb-deploy` exactly** (`3.4.6`, not `^3.4.0`) so the current
   path cannot break by accident while the decision is open.
3. If ArNS-on-Solana is confirmed: add `ario-deploy` as a devDependency and
   port `deploy:permaweb` / `deploy:resolver`, keeping the old scripts until a
   deploy has been verified end to end.
4. Move publishing to the **GitHub Action** with a controller key, matching
   `spintrade/deploy.yml` and `deltaverse/deploy.yml`.
5. Update [`../PRODUCTION_DEPLOY.md`](../PRODUCTION_DEPLOY.md) — it documents
   `npm run deploy:permaweb` and `DEPLOY_KEY` as the path today.

## Open questions

- Are `pythai` / `bankon` / `deltaverse` / `spintrade` registered as **ArNS**
  (Solana authority) or **Permaweb Names** (Arweave authority)?
- Post-migration, is `permaweb-deploy` still the supported path for ArNS at
  all, or is `ario-deploy` now the only one?
- Does `ario-deploy` support the ANT/undername operations the BANKON undername
  map needs, or is `@ar.io/sdk` still required directly for those?
