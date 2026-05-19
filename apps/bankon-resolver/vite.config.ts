// Vite config for the standalone BANKON Names resolver SPA.
// Build: vite build --config apps/bankon-resolver/vite.config.ts
// Output: apps/bankon-resolver/dist (then deployable via permaweb-deploy).

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',  // relative paths so the bundle works under arweave.net/<tx>/...
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(here, 'index.html'),
    },
  },
});
