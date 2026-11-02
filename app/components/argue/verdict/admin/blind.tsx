// Owner: verdict. Shared admin building blocks for the appeals and needs-review queues.
// Reviewers work BLIND by default (Side A = FOR, Side B = AGAINST) — identities sit behind a toggle,
// so a human decision is held to the same standard as the AI's.
import { ScoreBar } from "@/components/argue/ui/score-bar";
import { SideTag } from "@/components/argue/ui/side-tag";
import { LINK_REL, displayLink } from "@domain/lib/links";
import type { SideLabel } from "@domain/db/json-types";
import type { VerdictOutcome } from "@domain/db/schema";
import type { BlindSubmissions, CompetitionHeader, VerdictRecord } from "@domain/appeals/queries";

export const BLIND_SIDE: Record<SideLabel, string> = { A: "Side A (FOR)", B: "Side B (AGAINST)" };

export function blindOutcome(outcome: VerdictOutcome, winnerSide: SideLabel | null): string {
  switch (outcome) {
    case "A":
    case "B":
      return `${BLIND_SIDE[outcome]} wins`;
    case "draw":
      return "Draw";
    case "inconclusive":
      return "Inconclusive";
    case "forfeit":
      return winnerSide ? `${BLIND_SIDE[winnerSide]} wins by forfeit` : "Forfeit";
  }
}

export function CaseHeading({ header }: { header: CompetitionHeader }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        {header.category.name} &middot; rubric {header.rubric.id}@{header.rubric.version}
      </p>
      <p className="mt-0.5 font-display text-2xl font-bold leading-tight text-ink">&ldquo;{header.proposition}&rdquo;</p>
    </div>
  );
}

export function Identities({ header }: { header: CompetitionHeader }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-ink-3 hover:text-ink">Reveal participants (only if you need to)</summary>
      <ul className="mt-1 text-ink-2">
        {(["A", "B"] as const).map((s) => (
          <li key={s}>
            {BLIND_SIDE[s]}: {header.sides[s].displayName}
            {header.sides[s].handle ? ` (@${header.sides[s].handle})` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SubmissionsBlind({ submissions }: { submissions: BlindSubmissions }) {
  return (
    <details className="rounded-[var(--radius)] border border-line">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-ink">
        Read both submissions
      </summary>
      <div className="grid gap-4 border-t border-line p-3 lg:grid-cols-2">
        {(["A", "B"] as const).map((side) => (
          <div key={side} className="min-w-0">
            <SideTag side={side === "A" ? "FOR" : "AGAINST"} size="sm">
              {BLIND_SIDE[side]}
            </SideTag>
            {submissions[side].length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">No submissions.</p>
            ) : (
              submissions[side].map((s) => (
                <div key={s.round} className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                    {s.round}
                    {s.status !== "visible" ? ` · ${s.status} by moderators (still judged)` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{s.body}</p>
                  {s.links.length > 0 ? (
                    <ul className="mt-1 text-sm">
                      {s.links.map((href) => (
                        <li key={href}>
                          <a href={href} rel={LINK_REL} target="_blank" className="break-all text-for-strong underline">
                            {displayLink(href)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

export function VerdictBrief({ verdict }: { verdict: VerdictRecord }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] bg-surface-2 p-3">
      <p className="text-sm">
        <span className="font-semibold text-ink">Current verdict v{verdict.version}: </span>
        <span className="text-ink">{blindOutcome(verdict.outcome, verdict.outcomeView.winnerSide)}</span>
        <span className="text-ink-3">
          {" "}
          &middot; {verdict.decidedBy === "human" ? "human decision" : "AI"}
          {verdict.confidence !== null ? ` · confidence ${verdict.confidence.toFixed(2)}` : ""}
          {verdict.scores ? ` · ${verdict.scores.totals.A.toFixed(1)} – ${verdict.scores.totals.B.toFixed(1)}` : ""}
        </span>
      </p>
      {verdict.explanation?.summary ? <p className="text-sm text-ink-2">{verdict.explanation.summary}</p> : null}
      {verdict.reviewNote ? <p className="text-sm text-ink-2">Reviewer: {verdict.reviewNote}</p> : null}
      {verdict.scores && verdict.scores.criteria.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm text-ink-3 hover:text-ink">Per-criterion scores and reasons</summary>
          <div className="mt-2 flex flex-col gap-3">
            {verdict.scores.criteria.map((c) => {
              const detail = verdict.explanation?.perCriterion.find((p) => p.key === c.key);
              return (
                <div key={c.key}>
                  <ScoreBar label={c.label} weight={c.weight} forValue={c.A} againstValue={c.B} />
                  {detail ? (
                    <div className="mt-1 grid gap-2 text-xs text-ink-2 sm:grid-cols-2">
                      <p>
                        <span className="font-semibold">A:</span> {detail.A.reason}
                        {detail.A.quotes.length > 0 ? ` — “${detail.A.quotes.join("”, “")}”` : ""}
                      </p>
                      <p>
                        <span className="font-semibold">B:</span> {detail.B.reason}
                        {detail.B.quotes.length > 0 ? ` — “${detail.B.quotes.join("”, “")}”` : ""}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
