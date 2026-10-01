import { defineConfig } from "vite";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// libsodium-wrappers-sumo 0.7.16 publishes an ESM file that does
// `import "./libsodium-sumo.mjs"` — but that file ships in the sibling
// `libsodium-sumo` package, not next to the wrapper. Alias the relative
// import to the actual file so Rollup/Vite can resolve it. Found by walking
// the dependency chain with Node's resolver, so it works under pnpm's
// .pnpm/ layout and npm's hoisted one alike.
function packageDir(fromPackageJson: string, name: string): string {
  const req = createRequire(fromPackageJson);
  let dir = path.dirname(fs.realpathSync(req.resolve(name)));
  for (;;) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, "utf8")).name === name) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`cannot locate package ${name}`);
    dir = up;
  }
}
// @ts-expect-error process is a nodejs global
const rootPackageJson = path.join(process.cwd(), "package.json");
const xhdDir = packageDir(rootPackageJson, "@algorandfoundation/xhd-wallet-api");
const wrapperDir = packageDir(path.join(xhdDir, "package.json"), "libsodium-wrappers-sumo");
const sumoDir = packageDir(path.join(wrapperDir, "package.json"), "libsodium-sumo");
const libsodiumSumoMjs = path.join(sumoDir, "dist/modules-sumo-esm/libsodium-sumo.mjs");

// The app's version, from package.json, as a compile-time constant (__APP_VERSION__):
// one source of truth for every place the wallet names its own version.
const appVersion: string = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig(async () => ({
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  resolve: {
    alias: [
      {
        find: /^\.\/libsodium-sumo\.mjs$/,
        replacement: libsodiumSumoMjs,
      },
      // Polyfill the small subset of Node `crypto` that xhd-wallet-api uses
      // (createHash sha256/sha512, createHmac sha512). The shim is built on
      // @noble/hashes, which is already a parsec dependency.
      {
        find: /^crypto$/,
        replacement: path.resolve(
          // @ts-expect-error process is a nodejs global
          process.cwd(),
          "src/lib/algorand-hd/crypto-shim.ts",
        ),
      },
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Vite's dep pre-bundle (esbuild) doesn't see resolve.alias and uses its
  // own target. Exclude the libsodium chain so it goes through normal Vite
  // resolution (where the alias works), and bump esbuild's target to es2022
  // for any other deps that might emit TLA.
  optimizeDeps: {
    exclude: [
      "libsodium-wrappers-sumo",
      "libsodium-sumo",
      "@algorandfoundation/xhd-wallet-api",
    ],
    esbuildOptions: {
      target: "es2022",
    },
  },
  build: {
    // libsodium-wrappers-sumo and xhd-wallet-api use top-level await for
    // libsodium init. es2020 doesn't allow TLA — bump to es2022.
    // Tauri's webview is Chromium-based, so TLA is supported.
    target: "es2022",
    // Split heavy deps into separate chunks for caching
    rollupOptions: {
      output: {
        manualChunks: {
          algosdk: ["algosdk"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
}));
