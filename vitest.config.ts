import path from "node:path";

import { defineConfig } from "vitest/config";

const root = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  resolve: {
    // Keep in sync with tsconfig.json `paths` and vite.config.ts `argueItAliases`.
    alias: {
      "@domain": root("./server/domain"),
      "@tests/helpers": root("./server/domain/test-helpers"),
      "server-only": root("./server/shims/server-only.ts"),
      "next/cache": root("./server/shims/next-cache.ts"),
      "next/navigation": root("./server/shims/next-navigation-server.ts"),
      "next/server": root("./server/shims/next-server.ts"),
      "@": root("./app"),
      "@shared": root("./shared"),
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/.react-router/**",
      "e2e/**",
    ],
    // PGlite-backed domain specs (ported from the reference) need the reference timeouts.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // PGlite instances are memory-hungry; cap parallel workers.
    maxWorkers: 4,
  },
});
