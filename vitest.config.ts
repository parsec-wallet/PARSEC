import { defineConfig } from 'vitest/config';
import path from 'node:path';

// libsodium-wrappers-sumo 0.7.16 publishes an ESM file that does
// `import "./libsodium-sumo.mjs"` — but that file ships in the sibling
// `libsodium-sumo` package, not next to the wrapper. Without the alias
// below, Node ESM resolution fails. The plain Vite/Node bundler handles it
// fine in production because it follows the package.json exports of
// libsodium-sumo; only the test runner needs the explicit hint.
const libsodiumSumoMjs = path.resolve(
  process.cwd(),
  'node_modules/.pnpm/libsodium-sumo@0.7.16/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs',
);

export default defineConfig({
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
