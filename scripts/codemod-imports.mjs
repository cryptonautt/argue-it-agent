#!/usr/bin/env node
/**
 * Rewrites reference (Next.js ARGUE IT) import specifiers to the Agent-Native app's aliases,
 * across server/domain/** (or the directories passed as arguments).
 *
 *   @/server/        -> @domain/
 *   @/lib/           -> @domain/lib/
 *   @tests/helpers/  -> @domain/test-helpers/
 *
 * Usage: node scripts/codemod-imports.mjs [dir ...]   (default: server/domain)
 * Idempotent: running it twice changes nothing the second time.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REWRITES = [
  [/(["'`])@\/server\//g, "$1@domain/"],
  [/(["'`])@\/lib\//g, "$1@domain/lib/"],
  [/(["'`])@tests\/helpers\//g, "$1@domain/test-helpers/"],
];

export function rewrite(source) {
  let out = source;
  for (const [pattern, replacement] of REWRITES) out = out.replace(pattern, replacement);
  return out;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|mts|cts)$/.test(name)) {
      yield full;
    }
  }
}

function main(argv) {
  const dirs = argv.length > 0 ? argv : ["server/domain"];
  let changed = 0;
  let scanned = 0;
  for (const dir of dirs) {
    const abs = path.resolve(ROOT, dir);
    for (const file of walk(abs)) {
      scanned++;
      const before = readFileSync(file, "utf8");
      const after = rewrite(before);
      if (after !== before) {
        writeFileSync(file, after);
        changed++;
      }
    }
  }
  console.log(`codemod-imports: ${changed} of ${scanned} files rewritten`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
