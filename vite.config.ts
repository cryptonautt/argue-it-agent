import { fileURLToPath } from "node:url";

import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * ARGUE IT port aliases. Keep in sync with tsconfig.json `paths` and vitest.config.ts.
 * - `@domain/*` → the domain layer copied from the reference Next.js app.
 * - `server-only`, `next/cache`, `next/navigation`, `next/server` → server shims (server/shims/*).
 *   Client components never import these: their next/* imports are codemodded to app/shims/*.
 */
export const argueItAliases: Record<string, string> = {
  "@domain": fromRoot("./server/domain"),
  "@tests/helpers": fromRoot("./server/domain/test-helpers"),
  "server-only": fromRoot("./server/shims/server-only.ts"),
  "next/cache": fromRoot("./server/shims/next-cache.ts"),
  "next/navigation": fromRoot("./server/shims/next-navigation-server.ts"),
  "next/server": fromRoot("./server/shims/next-server.ts"),
};

export default defineConfig({
  resolve: {
    alias: argueItAliases,
  },
  optimizeDeps: {
    // ARGUE IT routes are not in `entries`, so Vite never discovered these and served them unbundled:
    // lucide-react's barrel alone was ~8,000 module requests per e2e browser context (~30 s per page load).
    // Agent-Native turns dependency discovery off (`noDiscovery`), so a dep missing here is served raw. The
    // trade panel's lazily imported Polymarket SDK broke on that: ox imports `{ EventEmitter }` from
    // eventemitter3, whose ESM wrapper re-exports a CommonJS file the browser can't load ("does not provide
    // an export named 'default'"). Prebundling bundles ox and eventemitter3 in. viem alone was also ~1,000
    // module requests per click. Browser entries only: `@polymarket/client/node` must never reach the client.
    include: [
      "lucide-react",
      "date-fns",
      "viem",
      "viem/chains",
      "@polymarket/client",
      "@polymarket/client/viem",
      "@polymarket/client/actions",
    ],
    entries: [
      "app/entry.client.tsx",
      "app/root.tsx",
      "app/components/layout/{Layout,Sidebar}.tsx",
      "app/components/chat/ChatRouteContent.tsx",
      "app/routes/{home,chat.$threadId}.tsx",
    ],
  },
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      ssrStubs: ["shiki"],
    }),
  ],
});
