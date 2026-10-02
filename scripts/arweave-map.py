#!/usr/bin/env python3
# Inventory every Arweave / ar.io / AO / naming source file in the repo and rewrite the generated
# block in docs/arweave-ario-map.md.
#
# The point is not the line counts. It is the UNMAPPED list: any file that talks about Arweave,
# ar.io, ArNS, ARIO, AO or the name registries and is not claimed by a group below gets printed,
# so the map cannot silently go stale as the tree grows.
#
# Usage: python3 scripts/arweave-map.py            # rewrite the block
#        python3 scripts/arweave-map.py --check    # exit 1 if the block is stale or a file is unmapped
import re, os, sys, glob, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(ROOT, "docs/arweave-ario-map.md")
BEGIN, END = "<!-- BEGIN INVENTORY -->", "<!-- END INVENTORY -->"

# What counts as "this is Arweave / ar.io code". Deliberately broad; the threshold below is what
# separates a module from a passing mention.
KEYWORDS = re.compile(
    r"arweave|ar\.io|ar-io|ArNS|arns|ARIO|mARIO|ans-?104|ANS-104|aoMessage|AO process|"
    r"aoconnect|permaweb|bankon-names|Marketspace|\bANT\b|namespaces/|cu\.ardrive|ao-testnet",
    re.I)
THRESHOLD = 3          # keyword hits before a file is considered in scope
SEARCH_ROOTS = ["src", "src-tauri/src", "apps", "scripts", "bankon-names-process", "marketplace-process"]
SKIP = re.compile(r"(^|/)(node_modules|dist|\.git|__snapshots__)(/|$)")
EXTS = (".ts", ".tsx", ".js", ".mjs", ".rs", ".lua", ".py", ".scss", ".html")

# Groups, in the order the doc presents them. Each is (title, [glob, …]).
GROUPS = [
    ("Keys & signing", [
        "src-tauri/src/chain_ar/*.rs", "src/lib/chain-ar.ts",
        "src/lib/arweave/seed.ts", "src/lib/arweave/derive-worker.ts", "src/lib/arweave/jwk.ts",
        "src/lib/arweave/module.ts", "src/lib/arweave/signer.ts", "src/lib/arweave/vault-key.ts"]),
    ("Transport & encoding", [
        "src/lib/arweave/client.ts", "src/lib/arweave/tx.ts", "src/lib/arweave/ans104.ts",
        "src/lib/arweave/ao.ts", "src/lib/arweave/inject.ts", "src/lib/arweave/index.ts",
        "src/lib/arweave/turbo.ts", "src/lib/arweave/manifest.ts",
        # Turbo uploads paid over x402 (USDC on Base) and the BANKONx402 fee — lib/bankon-fee.ts
        "src/lib/arweave/turbo-x402.ts"]),
    ("ar.io — AO era", [
        "src/lib/arweave/ario.ts", "src/lib/arweave/ant.ts", "src/lib/namespaces/arns.ts"]),
    ("ar.io — Solana era", [
        "src/lib/permaweb/*.ts", "src/lib/permaweb/*/*.ts", "src/lib/arweave/solana-arns-client.ts",
        "src/lib/namespaces/solana-arns.ts", "src/lib/solana/kit-signer.ts",
        "src/lib/solana/token.ts"]),
    ("Sovereign registries (BNR + BMR)", [
        "src/lib/bankon-names/*.ts", "src/lib/marketplace/*.ts", "src/lib/marketplace/providers/*.ts",
        "src/lib/namespaces/bankon.ts",
        "bankon-names-process/*.lua", "bankon-names-process/handlers/*.lua",
        "marketplace-process/*.lua", "marketplace-process/handlers/*.lua"]),
    ("Name model & desk", [
        "src/lib/names/*.ts", "src/lib/namespaces/types.ts", "src/lib/namespaces/registry.ts",
        "src/lib/namespaces/index.ts", "apps/parsec-names/*.js", "apps/parsec-names/*.html"]),
    ("Name stores (.algo + ArNS undernames)", [
        "src/lib/nfd/stores.ts", "src/lib/ui/store-editor.ts", "src/views/nfdominter-stores.ts"]),
    ("Views", ["src/views/arweave-*.ts", "src/views/ario-*.ts", "src/views/name-*.ts",
               "src/views/market-*.ts", "src/views/bankon-*.ts", "src/views/permaweb-*.ts",
               "src/views/connect-name-approve.ts"]),
    ("Surfaces (tiles, styles, probes)", [
        "src/lib/dashboard/ario-module.ts", "src/lib/dashboard/bankon-module.ts",
        "src/lib/dashboard/marketspace-module.ts",
        "src/styles/wallet/_permaweb.scss", "src/lib/diagnostics/endpoints.ts"]),
    ("Apps & scripts", [
        "apps/bankon-resolver/*.ts", "apps/bankon-resolver/*.html",
        "scripts/spawn-bnr.mjs", "scripts/spawn-bmr.mjs", "scripts/deploy-dato-ao.ts",
        "scripts/sync-ario-docs.py", "scripts/sync-toon-docs.py", "scripts/arweave-map.py"]),
    ("Tests", [
        "src/lib/arweave/__tests__/*.ts", "src/lib/permaweb/__tests__/*.ts",
        "src/lib/namespaces/__tests__/*.ts", "src/lib/names/__tests__/*.ts",
        "src/lib/marketplace/providers/__tests__/*.ts", "apps/parsec-names/test/*.mjs",
        "src/lib/__tests__/storage-cost.test.ts", "src/lib/__tests__/name-cost.test.ts",
        "src/lib/__tests__/nfd-stores.test.ts", "src/lib/__tests__/keycore-arweave-solana.test.ts"]),
]

# Files that mention the permaweb in passing and belong to another module. Listed, not hidden:
# the doc carries them as "peripheral touchpoints" so the map stays honest about the blast radius.
PERIPHERAL = [
    "src/views/matrix.ts", "src/views/dashboard.ts", "src/views/create-wallet.ts",
    "src/views/create-select.ts", "src/views/admin-keygen.ts", "src/views/mausoleum.ts",
    "src/views/linkage.ts", "src/views/onboarding.ts", "src/views/verify-mnemonic.ts",
    "src/views/docs.ts", "src/views/diagnostics.ts", "src/views/add-asset.ts", "src/views/swap.ts",
    "src/views/solana-create.ts", "src/views/solana-import.ts", "src/views/nfdominter-manage.ts",
    "src/lib/chains.ts", "src/lib/pouch/chains.ts", "src/lib/keystore.ts", "src/lib/store.ts",
    "src/lib/modules.ts", "src/lib/algorand-hd/crypto-shim.ts", "src/lib/dashboard/index.ts",
    "src/lib/dashboard/chain-wallets-module.ts", "src/lib/marketplace/providers/nfd-provider.ts",
    "src/main.ts", "src-tauri/src/lib.rs", "src-tauri/src/parsec_connect/mod.rs",
    "src-tauri/src/parsec_connect/server.rs", "src-tauri/src/parsec_connect/commands.rs",
    "src-tauri/src/bankon_vault/store.rs", "src-tauri/src/bankon_vault/vault.rs",
    "src-tauri/src/bankon_vault/overseer.rs",
    "src/lib/dashboard-modules.ts", "src/lib/nav.ts", "src/lib/types.ts", "src/types/wallet.ts",
    "src/lib/recovery.ts", "src/lib/__tests__/recovery.test.ts",
    "src/lib/builder/registry.ts", "src/lib/builder/types.ts",
    "src/lib/builder/multichain.ts", "src/lib/builder/isolation.ts",
    # x402 is a payment module, not a permaweb one — but its CAIP-2 table names the
    # `arweave` rail family, so the map claims it rather than reporting it unmapped.
    "src/lib/x402/networks.ts",
    # Mention Arweave or ArNS in passing (a probe list, the router's view table, logout, a
    # watcher of addresses): another module's files, listed so the blast radius stays honest.
    "src/lib/diag-profiles.ts", "src/lib/router.ts", "src/lib/session.ts",
    "src/lib/watch.ts", "src/lib/__tests__/watch.test.ts",
    # The Keycore's approval gate (asks before chain_ar_sign, among others) and the test that
    # lists where JavaScript may still touch a key.
    "src-tauri/src/bankon_vault/approval.rs", "src/lib/__tests__/keycore-js-surface.test.ts",
]


def lines(p):
    with open(p, encoding="utf-8", errors="ignore") as fh:
        return sum(1 for _ in fh)


def hits(p):
    with open(p, encoding="utf-8", errors="ignore") as fh:
        return sum(1 for line in fh if KEYWORDS.search(line))


def in_scope():
    found = []
    for root in SEARCH_ROOTS:
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, root)):
            rel_dir = os.path.relpath(dirpath, ROOT)
            if SKIP.search(rel_dir):
                dirnames[:] = []
                continue
            for fn in filenames:
                if not fn.endswith(EXTS):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), ROOT)
                if SKIP.search(rel):
                    continue
                if hits(os.path.join(ROOT, rel)) >= THRESHOLD:
                    found.append(rel)
    return sorted(found)


def expand(patterns):
    out = []
    for pat in patterns:
        out += [os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(ROOT, pat))]
    return sorted(set(p for p in out if os.path.isfile(os.path.join(ROOT, p))))


def main():
    check = "--check" in sys.argv
    claimed, rows, total_f, total_l = set(), [], 0, 0
    for title, pats in GROUPS:
        fs = expand(pats)
        claimed.update(fs)
        n = sum(lines(os.path.join(ROOT, f)) for f in fs)
        rows.append((title, len(fs), n))
        total_f += len(fs)
        total_l += n
    claimed.update(PERIPHERAL)

    unmapped = [f for f in in_scope() if f not in claimed]

    table = [f"| Group | Files | Lines |", "|---|--:|--:|"]
    table += [f"| {t} | {c} | {n:,} |" for t, c, n in rows]
    table.append(f"| **Total (mapped, excluding peripheral)** | **{total_f}** | **{total_l:,}** |")
    block = (f"{BEGIN}\n<!-- Generated by scripts/arweave-map.py — do not edit by hand. -->\n\n"
             + "\n".join(table)
             + f"\n\nGenerated {datetime.date.today().isoformat()}. "
             + (f"**{len(unmapped)} unmapped file(s):** " + ", ".join(f"`{u}`" for u in unmapped)
                if unmapped else
                "Every file in the tree carrying ≥3 Arweave/ar.io/AO/naming references is claimed "
                "by a group above or listed as a peripheral touchpoint — the map is complete.")
             + f"\n{END}")

    doc = open(DOC, encoding="utf-8").read()
    new = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda _: block, doc, flags=re.S)
    # The date records the last real change, so it must not itself count as one — otherwise
    # --check fails every morning on an untouched tree.
    undated = lambda t: re.sub(r"Generated \d{4}-\d{2}-\d{2}\. ", "Generated . ", t)
    unchanged = undated(new) == undated(doc)
    if check:
        stale = not unchanged
        for u in unmapped:
            print("UNMAPPED", u)
        if stale:
            print("STALE: docs/arweave-ario-map.md inventory block is out of date")
        sys.exit(1 if (stale or unmapped) else 0)
    if not unchanged:
        open(DOC, "w", encoding="utf-8").write(new)
    for u in unmapped:
        print("UNMAPPED", u)
    print(f"inventory: {total_f} files, {total_l} lines, {len(unmapped)} unmapped"
          + ("" if not unchanged else " (unchanged — date kept)"))


if __name__ == "__main__":
    main()
