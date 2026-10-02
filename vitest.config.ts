import fs from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

// libsodium-wrappers-sumo 0.7.16 publishes an ESM file that does
// `import "./libsodium-sumo.mjs"` — but that file ships in the sibling
// `libsodium-sumo` package, not next to the wrapper, so Node ESM resolution
// fails without an alias. Found by walking the dependency chain with Node's
// resolver (as vite.config.ts does), so it works under pnpm's .pnpm/ layout
// and npm's hoisted one alike — CI installs with npm.
function packageDir(fromPackageJson: string, name: string): string {
  const req = createRequire(fromPackageJson);
  let dir = path.dirname(fs.realpathSync(req.resolve(name)));
  for (;;) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, 'utf8')).name === name) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`cannot locate package ${name}`);
    dir = up;
  }
}
const xhdDir = packageDir(path.join(process.cwd(), 'package.json'), '@algorandfoundation/xhd-wallet-api');
const wrapperDir = packageDir(path.join(xhdDir, 'package.json'), 'libsodium-wrappers-sumo');
const sumoDir = packageDir(path.join(wrapperDir, 'package.json'), 'libsodium-sumo');
const libsodiumSumoMjs = path.join(sumoDir, 'dist/modules-sumo-esm/libsodium-sumo.mjs');


const appVersion: string = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  resolve: {
    alias: [
      {
        find: /^\.\/libsodium-sumo\.mjs$/,
        replacement: libsodiumSumoMjs,
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    server: {
      deps: {
        inline: ['libsodium-wrappers-sumo', '@algorandfoundation/xhd-wallet-api'],
      },
    },
  },
});
