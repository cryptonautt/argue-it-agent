/**
 * `pnpm tsx scripts/fairness.ts` — the AI-judge fairness suite (design §2 goal 8). Ported unchanged from
 * the reference app (Agent-Native port, plan Task 4); only imports moved to `@domain/*` and the env loading.
 *
 * Runs every case in fairness/cases/ through the production judging pipeline (blind case file from the
 * database → Pass 1 A-first → Pass 2 B-first → comparePasses → Pass 3 A-first + Pass 4 B-first if needed), computes the fairness
 * metrics, writes fairness/report.md + fairness/report.json and exits non-zero if any launch gate fails.
 *
 *   npm run fairness                         mock judge (offline, free) — the default, always
 *   npm run fairness -- --live               real judge: prints the estimated cost and stops
 *   npm run fairness -- --live --yes         real judge: spends money (needs ANTHROPIC_API_KEY)
 *   npm run fairness -- --case <id>[,<id>]   only these cases (gates without data are skipped)
 *   npm run fairness -- --filter <text>      only cases whose id contains <text>
 *   npm run fairness -- --concurrency <n>    cases judged in parallel (default: 8 mock, 3 live)
 *
 * Exit codes: 0 passed · 1 a gate failed or the run crashed · 2 nothing was run (bad arguments, missing
 * key, or --live without --yes). With the mock judge only the pipeline-integrity gates (blinding, quote
 * integrity, injection pre-scan, evaluation errors) decide the exit code: mock scores are text heuristics
 * and say nothing about real fairness, so the judge-quality launch gates are enforced only with --live.
 */
// Load .env.local then .env (the reference imported scripts/load-env.ts, which does exactly this).
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

class UsageError extends Error {}

const HELP = `Usage: npm run fairness -- [--live [--yes]] [--case id,id] [--filter text] [--concurrency n] [--out dir]`;

interface CliOptions {
  live: boolean;
  yes: boolean;
  caseIds: string[];
  filter: string | null;
  concurrency: number | null;
  outDir: string;
}

function parseCli(argv: string[]): CliOptions | "help" {
  const { values } = parseArgs({
    args: argv,
    options: {
      live: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      case: { type: "string" },
      filter: { type: "string" },
      concurrency: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return "help";
  let concurrency: number | null = null;
  if (values.concurrency !== undefined) {
    concurrency = Number.parseInt(values.concurrency, 10);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new UsageError("--concurrency must be 1-32");
  }
  if (values.yes && !values.live) throw new UsageError("--yes only makes sense with --live");
  return {
    live: values.live,
    yes: values.yes,
    caseIds: (values.case ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    filter: values.filter?.trim() || null,
    concurrency,
    outDir: path.resolve(values.out ?? "fairness"),
  };
}

async function main(): Promise<number> {
  let cli: CliOptions | "help";
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n${HELP}`);
    return 2;
  }
  if (cli === "help") {
    console.log(HELP);
    return 0;
  }

  // Provider choice is made through the same env switch the app uses, but forced here so a key sitting in
  // .env.local can never cause spending without an explicit --live. JUDGE_PROVIDER is always set
  // explicitly (the app has no default). --live uses the direct Anthropic provider: the framework engine
  // provider needs the running server's engine settings, so it is exercised through the job path instead.
  if (cli.live) {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      console.error("--live needs ANTHROPIC_API_KEY (in the environment or .env.local).");
      return 2;
    }
    process.env.JUDGE_PROVIDER = "anthropic";
  } else {
    process.env.JUDGE_PROVIDER = "mock";
  }

  // Imported after the env is fixed (and after load-env) so nothing reads stale configuration.
  const { getJudgeProvider, PROMPT_VERSION } = await import("@domain/judging");
  const { buildJudgeRequest } = await import("@domain/judging/providers/anthropic");
  const { loadCases } = await import("../fairness/lib/load-cases");
  const { prepareCases, judgePrepared } = await import("../fairness/lib/suite");
  const { estimateLiveCost } = await import("../fairness/lib/cost");
  const { formatPercent } = await import("../fairness/lib/gates");
  const { outcomeMatches } = await import("../fairness/lib/metrics");
  const { renderJson, renderMarkdown, resultLine, MOCK_BANNER, MOCK_DISCLAIMER } = await import("../fairness/lib/report");

  const allCases = loadCases();
  let cases = allCases;
  if (cli.caseIds.length > 0) {
    const unknown = cli.caseIds.filter((id) => !allCases.some((c) => c.id === id));
    if (unknown.length > 0) {
      console.error(`Unknown case id(s): ${unknown.join(", ")}`);
      return 2;
    }
    cases = cases.filter((c) => cli.caseIds.includes(c.id));
  }
  if (cli.filter) cases = cases.filter((c) => c.id.includes(cli.filter as string));
  if (cases.length === 0) {
    console.error("No cases selected.");
    return 2;
  }
  const filtered = cases.length !== allCases.length;

  const provider = getJudgeProvider();
  const expectedProvider = cli.live ? "anthropic" : "mock";
  if (provider.id !== expectedProvider) {
    console.error(`Refusing to run: expected the ${expectedProvider} judge provider but got "${provider.id}".`);
    return 1;
  }

  console.log(`Preparing ${cases.length} blind case files with the production case-file builder...`);
  const prepared = await prepareCases(cases);

  if (cli.live) {
    const promptChars = prepared.map((p) => {
      const { params } = buildJudgeRequest(
        { caseFile: p.built.caseFile, rubric: p.rubric, passNo: 1, order: "AB", promptVersion: PROMPT_VERSION },
        p.built.caseHash,
      );
      const system = params.system.reduce((n, block) => n + block.text.length, 0);
      const messages = params.messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
      return system + messages + JSON.stringify(params.output_config.format).length;
    });
    const estimate = estimateLiveCost(promptChars);
    console.log(
      [
        "",
        `LIVE RUN with ${provider.model}: ${estimate.cases} cases, up to ${estimate.maxPasses} judging passes.`,
        `Estimated cost: about $${estimate.typicalUsd.toFixed(2)} if every case settles in 2 passes,`,
        `up to $${estimate.worstCaseUsd.toFixed(2)} if every case needs the extra pair (4 passes; pessimistic: assumes long thinking, no prompt caching).`,
        "",
      ].join("\n"),
    );
    if (!cli.yes) {
      console.log("Nothing was spent. Re-run with --live --yes to confirm and start the paid run.");
      return 2;
    }
  }

  const started = Date.now();
  const concurrency = cli.concurrency ?? (cli.live ? 3 : 8);
  const result = await judgePrepared(prepared, {
    provider,
    promptVersion: PROMPT_VERSION,
    concurrency,
    filtered,
    onCaseDone: (run, done, total) => {
      const ok = outcomeMatches(run.expected, run.outcome);
      console.log(`  [${String(done).padStart(2)}/${total}] ${ok ? " " : "!"} ${run.id}: expected ${run.expected}, got ${run.outcome}`);
    },
  });

  const report = {
    schemaVersion: 1 as const,
    run: {
      generatedAt: new Date().toISOString(),
      providerId: provider.id,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      live: cli.live,
      filter: filtered ? [cli.caseIds.join(","), cli.filter].filter(Boolean).join(" ") : null,
      durationMs: Date.now() - started,
    },
    passed: result.passed,
    pipelinePassed: result.pipelinePassed,
    gates: result.gates,
    metrics: result.metrics,
    cases: result.runs,
  };
  mkdirSync(cli.outDir, { recursive: true });
  const mdPath = path.join(cli.outDir, "report.md");
  const jsonPath = path.join(cli.outDir, "report.json");
  writeFileSync(mdPath, renderMarkdown(report), "utf8");
  writeFileSync(jsonPath, renderJson(report), "utf8");

  if (!cli.live) console.log(`\n${"=".repeat(78)}\n  ${MOCK_BANNER}\n${"=".repeat(78)}`);
  console.log("\nLaunch gates:");
  for (const g of result.gates) {
    const mark = g.status === "pass" ? "PASS" : g.status === "fail" ? "FAIL" : "----";
    const kind = g.kind === "pipeline" ? "[pipeline]" : cli.live ? "[judge]   " : "[info]    ";
    console.log(`  ${mark} ${kind} ${g.label.padEnd(34)} ${formatPercent(g.value).padStart(6)}  (${g.detail})`);
  }
  if (!cli.live) console.log(`\nNOTE: ${MOCK_DISCLAIMER}`);
  console.log(`\nWrote ${path.relative(process.cwd(), mdPath)} and ${path.relative(process.cwd(), jsonPath)}.`);
  console.log(resultLine(report));
  const ok = cli.live ? result.passed : result.pipelinePassed;
  return ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
