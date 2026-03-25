import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  clearScreen: false,
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
  build: {
    // Split heavy deps into separate chunks for caching
    rollupOptions: {
      output: {
        manualChunks: {
          algosdk: ["algosdk"],
          blueprint: ["@blueprintjs/core", "@blueprintjs/icons"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
}));
