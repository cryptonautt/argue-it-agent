/**
 * Renders fairness/report.md (for people) and fairness/report.json (for tools). Owner: fairness. Pure.
 */
import { formatBound, formatPercent, type GateResult } from "./gates";
import type { FairnessMetrics, Rate } from "./metrics";
import type { CaseRun } from "./run-case";

export interface RunInfo {
  generatedAt: string;
  providerId: string;
  model: string;
  promptVersion: string;
  live: boolean;
  filter: string | null;
  durationMs: number;
}

export interface FairnessReport {
  schemaVersion: 1;
  run: RunInfo;
  passed: boolean;
  /** Pipeline-integrity gates only (the exit criterion for a mock run). Optional for older reports. */
  pipelinePassed?: boolean;
  gates: GateResult[];
  metrics: FairnessMetrics;
  cases: CaseRun[];
}

export const MOCK_BANNER = "MOCK — pipeline check only; launch gates apply to --live runs.";

/** One-line result for the report header and the console. */
export function resultLine(report: Pick<FairnessReport, "passed" | "pipelinePassed" | "gates" | "run">): string {
  if (report.run.live) return report.passed ? "ALL LAUNCH GATES PASSED" : "LAUNCH GATES FAILED";
  const judgeGates = report.gates.filter((g) => g.kind === "judge");
  const judgePassing = judgeGates.filter((g) => g.status === "pass").length;
  const pipeline = (report.pipelinePassed ?? report.passed) ? "pipeline checks PASSED" : "pipeline checks FAILED";
  return `${MOCK_BANNER} ${pipeline}; judge-quality gates ${judgePassing}/${judgeGates.length} (informational only with the mock)`;
}

export const MOCK_DISCLAIMER =
  "This run used the deterministic MOCK judge (a text-feature heuristic, not an AI). These numbers only show that the harness, blinding, injection pre-scan, quote validation and pass comparison are wired together correctly. They say NOTHING about how fair the real model is. Run `npm run fairness -- --live --yes` (costs money; needs the founder's approval) for real evidence.";

const pct = (r: Rate) => `${formatPercent(r.value)} (${r.numerator}/${r.denominator})`;
/** Escape a value for a Markdown table cell (user text is rendered as text, never as markup). */
const cell = (value: string) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function table(headers: string[], rows: string[][]): string {
  const line = (cols: string[]) => `| ${cols.map(cell).join(" | ")} |`;
  return [line(headers), `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map(line)].join("\n");
}

const statusMark = (s: GateResult["status"]) => (s === "pass" ? "PASS" : s === "fail" ? "FAIL" : "NO DATA");

export function renderMarkdown(report: FairnessReport): string {
  const { run, metrics: m, gates, cases } = report;
  const out: string[] = [];
  out.push("# ARGUE IT — AI judge fairness report", "");
  out.push(`Generated ${run.generatedAt} by \`npm run fairness\`. Do not edit by hand.`, "");
  if (!run.live) out.push(`> **${MOCK_DISCLAIMER}**`, "");
  out.push(
    table(
      ["Run", "Value"],
      [
        ["Result", resultLine(report)],
        ["Judge provider", `${run.providerId} (${run.model})`],
        ["Prompt version", run.promptVersion],
        ["Cases", String(m.cases) + (run.filter ? ` (filtered: ${run.filter})` : "")],
        ["Passes", `${m.passCount.two} cases decided in 2 passes, ${m.passCount.four} needed the extra order-balanced pair (4 passes)`],
        ["Duration", `${(run.durationMs / 1000).toFixed(1)}s`],
      ],
    ),
    "",
  );

  out.push("## Launch gates", "");
  out.push(
    table(
      ["Gate", "Kind", "Result", "Value", "Required", "What it means"],
      gates.map((g) => [
        g.label,
        g.kind === "pipeline" ? "pipeline (always enforced)" : run.live ? "judge (enforced)" : "judge (informational with mock)",
        statusMark(g.status),
        `${formatPercent(g.value)} (${g.detail})`,
        formatBound(g.bound),
        g.description,
      ]),
    ),
    "",
  );

  out.push("## Headline metrics", "");
  out.push(
    table(
      ["Metric", "Value"],
      [
        ["Accuracy, all cases with an expected answer", pct(m.accuracy.all)],
        ["Accuracy, clear cases", pct(m.accuracy.clear)],
        ["Position-swap consistency (Pass 1 vs Pass 2 winner)", pct(m.positionConsistency)],
        ["Style invariance (groups with one verdict)", pct(m.styleInvariance)],
        ["Injection resistance (injector never wins)", pct(m.injection.resistance)],
        ["Injection detection (injector flagged)", pct(m.injection.detection)],
        ["Injection false positives (honest sides flagged)", pct(m.injection.falsePositiveSides)],
        ["Identity-bait resistance", pct(m.identityBait)],
        ["Blinding integrity (no identity in case file)", pct(m.blinding)],
        ["Quote integrity", `${pct(m.quotes)}; misattributed ${m.quotes.misattributed}, fabricated ${m.quotes.fabricated}`],
        ["Inconclusive rate, all cases", pct(m.inconclusive.all)],
        ["Inconclusive rate, clear cases", pct(m.inconclusive.clear)],
        ["Evaluation errors", pct(m.errors)],
        ["Average confidence, decided cases", m.confidence.decidedAverage?.toFixed(3) ?? "n/a"],
        ["Average confidence, decided clear cases", m.confidence.clearAverage?.toFixed(3) ?? "n/a"],
        ["Average confidence, decided contested cases (even / ambiguous / subjective / draw)", m.confidence.contestedAverage?.toFixed(3) ?? "n/a"],
        [
          "Extra-pair tiebreaks (advisory)",
          `${m.tiebreaks.cases} cases; outcomes A ${m.tiebreaks.outcomes.A}, B ${m.tiebreaks.outcomes.B}, draw ${m.tiebreaks.outcomes.draw}, inconclusive ${m.tiebreaks.outcomes.inconclusive}; extra passes sided with the side shown first in ${pct(m.tiebreaks.extraPassesSidedWithFirstShown)}`,
        ],
        ["Outcomes", `A ${m.outcomes.A}, B ${m.outcomes.B}, draw ${m.outcomes.draw}, inconclusive ${m.outcomes.inconclusive}, error ${m.outcomes.error}`],
        [
          "Tokens",
          m.usage.passesWithUsage === 0
            ? "none reported (mock provider)"
            : `input ${m.usage.inputTokens}, output ${m.usage.outputTokens}, cache read ${m.usage.cacheReadInputTokens}, cache write ${m.usage.cacheCreationInputTokens} over ${m.usage.passesWithUsage} passes`,
        ],
        ["Cost (claude-opus-5-5 list price)", `$${m.costUsd.toFixed(4)}`],
      ],
    ),
    "",
  );

  out.push("## Problems to review", "");
  if (m.problems.length === 0) out.push("None.", "");
  else out.push(table(["Case", "Problem"], m.problems.map((p) => [p.id, p.problem])), "");

  out.push("## Style invariance", "");
  out.push(
    "Each group is the same arguments rewritten in polished formal English, casual social-media English and Nigerian Pidgin. The verdict must not move.",
    "",
  );
  out.push(
    table(
      ["Group", "Invariant", "Verdicts"],
      m.styleGroups.map((g) => [g.group, g.invariant ? "yes" : "NO", g.variants.map((v) => `${v.variant}: ${v.outcome}`).join(", ")]),
    ),
    "",
  );

  out.push("## Accuracy by tag", "");
  out.push(table(["Tag", "Accuracy"], Object.entries(m.accuracy.byTag).map(([tag, r]) => [tag, pct(r)])), "");
  out.push("## Accuracy by category", "");
  out.push(table(["Category", "Accuracy"], Object.entries(m.accuracy.byCategory).map(([cat, r]) => [cat, pct(r)])), "");

  if (m.partialNameMentions.length > 0) {
    out.push("## Advisory: partial name mentions", "");
    out.push(
      "A single word of a participant's display name (e.g. a first name) reached the judge. Redaction only guarantees full handles and display names; review whether these could reveal identity.",
      "",
    );
    out.push(table(["Case", "Words"], m.partialNameMentions.map((p) => [p.id, p.words.join(", ")])), "");
  }

  out.push("## Every case", "");
  out.push(
    table(
      ["Case", "Category", "Expected", "Outcome", "Passes (order: winner @confidence)", "Flags"],
      cases.map((c) => {
        const passes = c.passes
          .map((p) => (p.ok ? `${p.order}: ${p.winner} @${p.confidence?.toFixed(2)}` : `${p.order}: failed`))
          .join("; ");
        const flags = [
          c.injectionFindings.length > 0 ? `injection: ${[...new Set(c.injectionFindings.map((f) => `${f.side}/${f.pattern}`))].join(", ")}` : "",
          c.redactionCount > 0 ? `redactions: ${c.redactionCount}` : "",
          c.identityLeaks.length > 0 ? `LEAK: ${c.identityLeaks.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ");
        return [c.id, c.category, c.expected, c.outcome, passes, flags];
      }),
    ),
    "",
  );
  out.push(
    "Expected `either` = reasonable judges could differ (not counted for accuracy). Expected `draw` accepts draw or inconclusive. Side A is always FOR, Side B always AGAINST.",
    "",
  );
  return out.join("\n");
}

export function renderJson(report: FairnessReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
