/** Shared by playwright.config.ts and the specs. Test-only values; never use them in a real deployment. */
export const E2E_PORT = 3100;

/** Throwaway PGlite folder for e2e runs. Wiped before every run. Never the shared `data/pglite`. */
export const E2E_DB_DIR = "data/e2e-pglite";

/** Password for accounts the specs register themselves (Better Auth minimum is 8 chars). */
export const PASSWORD = "e2e-password-123";

/**
 * Password the seed (scripts/seed.ts, Task 9) uses for demo accounts, same as the reference
 * `scripts/seed/demo-data.ts`. If the seed only writes ARGUE IT `users` rows (no Better Auth account),
 * the helpers register the Better Auth account with this password on first use.
 */
export const DEMO_PASSWORD = "argueit-demo-2026";

/** Seeded moderator (reference persona @ngozi_mod). */
export const MODERATOR_EMAIL = "ngozi@argueit.test";
