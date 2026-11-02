import { fileURLToPath } from "node:url";

/**
 * Nitro server-build aliases for the ARGUE IT port.
 *
 * `agent-native build` (core dist/deploy/build.js) passes Nitro only the "@" and "@shared" aliases, so the
 * domain imports (`@domain/*`) and the server shims stayed bare specifiers in `.output/server` and the
 * production server could not start (ERR_MODULE_NOT_FOUND). Nitro loads this file through c12 (name "nitro")
 * and deep-merges it with core's inline config, so these aliases reach the server bundle.
 *
 * Keep in sync with `argueItAliases` in vite.config.ts (dev/SSR), tsconfig.json `paths` and vitest.config.ts.
 * Not imported from vite.config.ts on purpose: that would load the Vite plugins at Nitro config time.
 */
const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default {
  alias: {
    "@domain": fromRoot("./server/domain"),
    "server-only": fromRoot("./server/shims/server-only.ts"),
    "next/cache": fromRoot("./server/shims/next-cache.ts"),
    "next/navigation": fromRoot("./server/shims/next-navigation-server.ts"),
    "next/server": fromRoot("./server/shims/next-server.ts"),
  },
};
