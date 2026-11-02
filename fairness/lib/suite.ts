/**
 * The fairness suite end to end: cases → real blind case files → judging passes → metrics → gates.
 * Owner: fairness. Used by scripts/fairness.ts and by the harness tests (with fake providers).
 */
import type { JudgeProvider } from "@domain/judging";
import type { FairnessCase } from "./case-schema";
import { FairnessDatabase, type PreparedCase } from "./case-source";
import { gatesPassed, pipelineGatesPassed, type GateResult } from "./gates";
import { computeMetrics, evaluateGates, type FairnessMetrics } from "./metrics";
import { mapWithConcurrency, runCase, type CaseRun } from "./run-case";

export interface SuiteOptions {
  provider: JudgeProvider;
  promptVersion: string;
  /** Cases judged at the same time (each case runs up to 4 passes). */
  concurrency?: number;
  /** True when the case list is a deliberate subset (gates with no data are then tolerated). */
  filtered?: boolean;
  onCaseDone?: (run: CaseRun, index: number, total: number) => void;
}

export interface SuiteResult {
  runs: CaseRun[];
  metrics: FairnessMetrics;
  gates: GateResult[];
  /** Every gate passed (what a --live run must achieve before launch). */
  passed: boolean;
  /** The pipeline-integrity gates passed (what a mock run is held to). */
  pipelinePassed: boolean;
}

/** Build the blind case file for every case with the production code (one isolated in-memory DB). */
export async function prepareCases(cases: readonly FairnessCase[]): Promise<PreparedCase[]> {
  const database = await FairnessDatabase.open();
  try {
    const prepared: PreparedCase[] = [];
    // Sequential: PGlite is a single connection, and preparation is fast compared with judging.
    for (const c of cases) prepared.push(await database.prepare(c));
    return prepared;
  } finally {
    await database.close();
  }
}

export async function judgePrepared(prepared: readonly PreparedCase[], options: SuiteOptions): Promise<SuiteResult> {
  let done = 0;
  const runs = await mapWithConcurrency(prepared, options.concurrency ?? 4, async (p) => {
    const run = await runCase(p, { provider: options.provider, promptVersion: options.promptVersion });
    done += 1;
    options.onCaseDone?.(run, done, prepared.length);
    return run;
  });
  const metrics = computeMetrics(runs);
  const gates = evaluateGates(metrics);
  const filtered = options.filtered ?? false;
  return { runs, metrics, gates, passed: gatesPassed(gates, { filtered }), pipelinePassed: pipelineGatesPassed(gates, { filtered }) };
}

export async function runSuite(cases: readonly FairnessCase[], options: SuiteOptions): Promise<SuiteResult> {
  return judgePrepared(await prepareCases(cases), options);
}
