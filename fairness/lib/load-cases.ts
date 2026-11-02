/** Load and validate every fairness case JSON file. Owner: fairness. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fairnessCaseSchema, type FairnessCase } from "./case-schema";

export const CASES_DIR = fileURLToPath(new URL("../cases", import.meta.url));

export class CaseLoadError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
  ) {
    super(message);
    this.name = "CaseLoadError";
  }
}

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listJsonFiles(full);
      return entry.isFile() && entry.name.endsWith(".json") ? [full] : [];
    })
    .sort();
}

/**
 * Parse every `*.json` under `dir` (recursively). The file name must equal `<id>.json` and ids must be
 * unique. Throws a CaseLoadError listing every problem so a broken suite fails loudly, never silently.
 */
export function loadCases(dir: string = CASES_DIR): FairnessCase[] {
  const problems: string[] = [];
  const cases: FairnessCase[] = [];
  const seen = new Set<string>();

  for (const file of listJsonFiles(dir)) {
    const rel = path.relative(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`${rel}: invalid JSON (${(error as Error).message})`);
      continue;
    }
    const parsed = fairnessCaseSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) problems.push(`${rel}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      continue;
    }
    const c = parsed.data;
    if (path.basename(file, ".json") !== c.id) problems.push(`${rel}: file name must be "${c.id}.json"`);
    if (seen.has(c.id)) problems.push(`${rel}: duplicate id "${c.id}"`);
    seen.add(c.id);
    cases.push(c);
  }

  if (problems.length > 0) throw new CaseLoadError(`Invalid fairness cases:\n  ${problems.join("\n  ")}`, problems);
  return cases;
}
