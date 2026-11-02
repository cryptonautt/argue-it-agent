// Owner: verdict. Every judging pass of every run, side by side (canonical labels: A = FOR, B = AGAINST).
import { Badge } from "@/components/argue/ui/badge";
import { cn } from "@domain/lib/cn";
import type { PassRecord, RunRecord } from "@domain/appeals/queries";

const fmt = (n: number | null, digits = 1) => (n === null ? "–" : n.toFixed(digits));

function PassColumn({ pass, totals }: { pass: PassRecord; totals: { A: number; B: number } | undefined }) {
  const failed = pass.error !== null || (pass.parsed === null && pass.rawJson === null);
  return (
    <div className={cn("min-w-[15rem] flex-1 rounded-[var(--radius)] border p-3", failed ? "border-danger" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-xl font-bold text-ink">Pass {pass.passNo}</span>
        <Badge tone="outline">{pass.order === "AB" ? "A read first" : "B read first"}</Badge>
        {failed ? <Badge tone="danger">Failed</Badge> : null}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-3">Winner</dt>
        <dd className="font-semibold text-ink">{pass.parsed?.winner ?? "–"}</dd>
        <dt className="text-ink-3">Totals A / B</dt>
        <dd className="tabular text-ink">{totals ? `${fmt(totals.A)} / ${fmt(totals.B)}` : "–"}</dd>
        <dt className="text-ink-3">Confidence</dt>
        <dd className="tabular text-ink">{fmt(pass.confidence ?? pass.parsed?.confidence ?? null, 2)}</dd>
        <dt className="text-ink-3">Invalid quotes</dt>
        <dd className={cn("tabular", pass.invalidQuoteCount > 0 ? "font-semibold text-warning" : "text-ink")}>
          {pass.invalidQuoteCount}
        </dd>
        <dt className="text-ink-3">Model</dt>
        <dd className="truncate text-ink" title={`${pass.provider} · ${pass.model}`}>
          {pass.model}
        </dd>
        <dt className="text-ink-3">Prompt</dt>
        <dd className="text-ink">{pass.promptVersion}</dd>
        <dt className="text-ink-3">Stop reason</dt>
        <dd className="text-ink">{pass.stopReason ?? "–"}</dd>
        <dt className="text-ink-3">Latency</dt>
        <dd className="tabular text-ink">{pass.latencyMs === null ? "–" : `${(pass.latencyMs / 1000).toFixed(1)}s`}</dd>
      </dl>
      {pass.error ? <p className="mt-2 break-words text-xs text-danger">{pass.error}</p> : null}
      {pass.parsed ? (
        <>
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-ink-3">
                <th className="text-left font-semibold">Criterion</th>
                <th className="text-right font-semibold text-for-strong">A</th>
                <th className="text-right font-semibold text-against-strong">B</th>
              </tr>
            </thead>
            <tbody>
              {pass.parsed.criteria.map((c) => (
                <tr key={c.key} className="border-t border-line">
                  <td className="py-1 text-ink">{c.key}</td>
                  <td className="tabular py-1 text-right text-ink">{fmt(c.A, 0)}</td>
                  <td className="tabular py-1 text-right text-ink">{fmt(c.B, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pass.parsed.rationale ? <p className="mt-2 text-xs text-ink-2">{pass.parsed.rationale}</p> : null}
        </>
      ) : pass.rawJson ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-ink-3">Raw output</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface-2 p-2 text-[0.7rem] whitespace-pre-wrap break-words">
            {pass.rawJson}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function PassCompare({ runs }: { runs: readonly RunRecord[] }) {
  if (runs.length === 0) return <p className="text-sm text-ink-3">No evaluation runs recorded.</p>;
  return (
    <div className="flex flex-col gap-4">
      {runs.map((run, index) => {
        const totals = new Map((run.comparison?.totals ?? []).map((t) => [t.passNo, t]));
        return (
          <div key={run.id}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-ink">{index === 0 ? "Latest run" : "Earlier run"}</span>
              <Badge tone={run.status === "failed" ? "danger" : run.status === "succeeded" ? "success" : "warning"}>
                {run.status}
              </Badge>
              <Badge tone="outline">{run.reason === "appeal" ? "appeal re-evaluation" : "first evaluation"}</Badge>
              {run.injectionFindingCount > 0 ? <Badge tone="warning">{run.injectionFindingCount} injection flag(s)</Badge> : null}
              <span className="tabular text-xs text-ink-3" title="sha256 of the blind case file">
                case {run.caseHash.slice(0, 12)}
              </span>
            </div>
            {run.comparison?.reason ? <p className="mb-2 text-sm text-ink-2">Comparison: {run.comparison.reason}</p> : null}
            {run.error ? <p className="mb-2 text-sm text-danger">{run.error}</p> : null}
            <div className="flex gap-3 overflow-x-auto pb-2">
              {run.passes.length === 0 ? (
                <p className="text-sm text-ink-3">No passes recorded for this run.</p>
              ) : (
                run.passes.map((p) => <PassColumn key={p.id} pass={p} totals={totals.get(p.passNo)} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
