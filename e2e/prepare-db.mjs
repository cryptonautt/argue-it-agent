// Runs before the e2e dev server starts (playwright.config.ts webServer.command).
// 1. Wipes the throwaway e2e PGlite folder (never the shared data/pglite).
// 2. Seeds it with the demo data (scripts/seed.ts, Task 9) while no server holds the database:
//    PGlite is single-process, so seeding must finish before `agent-native dev` opens it.
// Usage: node e2e/prepare-db.mjs <dbDir>
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const dbDir = process.argv[2];
if (!dbDir || !/e2e/.test(dbDir)) {
  console.error(`prepare-db: refusing to wipe "${dbDir}" (the folder name must contain "e2e")`);
  process.exit(1);
}
rmSync(path.resolve(dbDir), { recursive: true, force: true });

if (!existsSync("scripts/seed.ts")) {
  console.warn("prepare-db: scripts/seed.ts not found; e2e/moderator-agent.spec.ts needs the demo seed.");
  process.exit(0);
}
const result = spawnSync("npx", ["tsx", "scripts/seed.ts"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: `pglite:./${dbDir}` },
});
process.exit(result.status ?? 1);
