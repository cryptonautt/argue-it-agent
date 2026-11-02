// Owner: verdict. "How this was judged" — the fairness safeguards behind THIS verdict, in plain words.
import Link from "@/shims/next-link";
import { BookOpen, Cpu, EyeOff, Flag, Repeat, Scale, Shuffle, UserCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { VerdictRecord } from "@domain/appeals/queries";
import type { RubricDef } from "@domain/judging/types";

function Row({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span aria-hidden className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="font-semibold text-ink">{title}</dt>
        <dd className="text-sm text-ink-2">{children}</dd>
      </div>
    </div>
  );
}

export interface HowJudgedProps {
  verdict: VerdictRecord;
  rubric: RubricDef | null;
  rubricRef: { id: string; version: number };
}

export function HowJudged({ verdict, rubric, rubricRef }: HowJudgedProps) {
  const method = verdict.explanation?.method ?? null;
  const rubricLabel = `${rubric?.name ?? rubricRef.id} · version ${rubricRef.version}`;
  const rubricLink = (
    <Link href={`/rules#rubric-${rubricRef.id}`} className="font-semibold text-ink underline underline-offset-2">
      {rubricLabel}
    </Link>
  );

  return (
    <section aria-labelledby="how-judged-title" className="rounded-[var(--radius-lg)] border border-line bg-surface p-4 sm:p-5">
      <h2 id="how-judged-title" className="text-3xl text-ink">
        {verdict.outcome === "forfeit" ? "How this was decided" : "How this was judged"}
      </h2>
      <dl className="mt-4 flex flex-col gap-4">
        {verdict.outcome === "forfeit" ? (
          <Row icon={<Flag />} title="No AI judging needed">
            One side didn&rsquo;t submit an opening before the deadline, so the no-show rule in the challenge terms
            applied. A forfeit moves ratings by half as much as a judged win.
          </Row>
        ) : (
          <>
            <Row icon={<EyeOff />} title="Blind">
              The judge saw only the proposition, the rubric and the two submissions, labelled Side A (FOR) and Side B
              (AGAINST). No names, photos, followers, reactions, ratings, or who challenged whom. Names typed inside a
              submission were replaced with [Side A] / [Side B].
            </Row>
            <Row icon={<Shuffle />} title="Two passes, in swapped order">
              One pass read Side A first; a separate pass read Side B first with the labels swapped, so going first or
              second can&rsquo;t help either side.
              {method ? ` This verdict used ${method.passCount} pass${method.passCount === 1 ? "" : "es"} (${method.orders.join(", ")}).` : ""}
            </Row>
            {method && method.passCount >= 3 ? (
              <Row icon={<Repeat />} title="Extra passes">
                The first two passes disagreed, so {method.passCount - 2} more fresh pass
                {method.passCount - 2 === 1 ? " was" : "es were"} run
                {method.passCount === 4 ? ", one in each reading order so neither side gets the first-read advantage" : ""}
                . A winner only stands if at least 3 of the 4 passes agree and they&rsquo;re confident enough; otherwise
                the result is inconclusive.
              </Row>
            ) : verdict.outcome !== "inconclusive" && verdict.decidedBy === "ai" ? (
              <Row icon={<Repeat />} title="Passes agreed">
                Both passes reached the same result independently, so no tie-break pass was needed.
              </Row>
            ) : null}
            <Row icon={<Scale />} title="Never a forced winner">
              If the passes disagree or aren&rsquo;t confident, the result is a draw or inconclusive and a human reviews
              it. Inconclusive results don&rsquo;t change anyone&rsquo;s rating.
            </Row>
            <Row icon={<BookOpen />} title="Rubric">
              Both sides were scored on the same criteria and weights: {rubricLink}. The rubric was locked into the
              challenge terms before either side accepted.
            </Row>
            {method ? (
              <Row icon={<Cpu />} title="Model and prompt">
                <span className="tabular">{method.model}</span> &middot; prompt <span className="tabular">{method.promptVersion}</span>.
                Every pass is stored with these versions and a fingerprint of exactly what the judge saw.
              </Row>
            ) : null}
          </>
        )}
        {verdict.decidedBy === "human" ? (
          <Row icon={<UserCheck />} title="Decided by a human reviewer">
            A moderator who wasn&rsquo;t part of this debate set this outcome, following the same published rules. Their
            written reason is shown above and the earlier result is kept in the history below.
          </Row>
        ) : null}
      </dl>
      <p className="mt-4 text-sm text-ink-2">
        The AI judge can make mistakes. That&rsquo;s why every verdict shows its reasons and quotes, and why either
        debater can appeal once.{" "}
        <Link href="/rules#judging" className="font-semibold text-ink underline underline-offset-2">
          Read how judging works
        </Link>
      </p>
    </section>
  );
}
