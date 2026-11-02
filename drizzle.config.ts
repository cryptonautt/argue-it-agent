import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";

// `pnpm db:generate` (drizzle-kit generate) needs no database: it diffs the schema against drizzle/meta.
// The running app applies drizzle/*.sql through runDrizzleMigrations in server/plugins/db.ts.
export default createDrizzleConfig({
  schema: "./server/domain/db/schema.ts",
  out: "./drizzle",
});
