import { defineConfig, devices } from "@playwright/test";
import { E2E_DB_DIR, E2E_PORT } from "./e2e/constants";

/**
 * Browser smoke tests live in e2e/ (owner: integration). `pnpm e2e` (= `playwright test`):
 *
 * 1. wipes a THROWAWAY PGlite database (data/e2e-pglite) and seeds it with the demo data (e2e/prepare-db.mjs);
 * 2. starts `agent-native dev` on port 3100 against it, with JUDGE_PROVIDER=mock set explicitly.
 *
 * It never touches your dev data (data/pglite) and never calls a paid model. Stop any other dev server in this
 * folder first. The mock judge is for this throwaway e2e server only; the demo uses a real provider.
 */

/**
 * Browser: the locally installed Google Chrome by default (no browser download needed). Set
 * PW_CHANNEL=bundled to use Playwright's own Chromium instead (run `npx playwright install chromium` once).
 */
const channel = process.env.PW_CHANNEL === "bundled" ? undefined : (process.env.PW_CHANNEL ?? "chrome");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], channel } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
  ],
  webServer: {
    // `agent-native dev` forwards extra flags to Vite. Not `pnpm dev`, which adds --open.
    command: `node e2e/prepare-db.mjs ${E2E_DB_DIR} && npx agent-native dev --port ${E2E_PORT} --strictPort`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL: `pglite:./${E2E_DB_DIR}`,
      PORT: String(E2E_PORT),
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-e2e",
      BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
      // Each test person signs in as themselves; without this every context is the same auto dev account.
      AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT: "1",
      // Password sign-up without waiting on an inbox (local/test default, stated explicitly).
      AUTH_SKIP_EMAIL_VERIFICATION: "1",
      AUTH_MAGIC_LINK: "0",
      // Explicit, e2e only. getJudgeProvider() has no default and never falls back to mock on its own.
      JUDGE_PROVIDER: "mock",
    },
  },
});
