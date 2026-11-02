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
