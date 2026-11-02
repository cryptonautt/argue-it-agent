// Owner: challenges. The full terms of a direct challenge + the pinned rubric (design §4.2). Isomorphic:
// rendered by the setup form (preview before sending) and the competition room (what was agreed).
import { FileText, Gavel, Scale } from "lucide-react";
import { SideTag } from "@/components/argue/ui/side-tag";
import { cn } from "@domain/lib/cn";
import type { RulesSnapshot } from "@domain/db/json-types";
import { FORMAT_SUMMARY, JUDGING_SUMMARY, type RubricView } from "@domain/competitions/terms";

const nf = new Intl.NumberFormat("en-GB");

export interface TermsPanelProps {
  terms: Pick<
    RulesSnapshot,
    | "proposition"
    | "category"
    | "challengerSide"
    | "recipientSide"
    | "roundDurationHours"
    | "acceptWindowHours"
    | "limits"
    | "rulesText"
  >;
  rubric: RubricView | null;
  /** Who argues each side, e.g. "You" / "@amaka". */
  forName: string;
  againstName: string;
  /** Shown when the terms are frozen (competition room). */
  fingerprint?: string;
  className?: string;
}

export function TermsPanel({ terms, rubric, forName, againstName, fingerprint, className }: TermsPanelProps) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <section>
        <h3 className="text-sm font-semibold tracking-wide text-ink-3 uppercase">
          The proposition
        </h3>
        <p className="mt-1 font-display text-2xl leading-tight text-ink sm:text-3xl">“{terms.proposition}”</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <li className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-for-soft px-3 py-2">
            <SideTag side="FOR" size="sm" />
            <span className="min-w-0 truncate text-sm font-semibold text-for-strong">{forName}</span>
            <span className="ml-auto text-xs text-for-strong">argues it’s true</span>
          </li>
          <li className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-against-soft px-3 py-2">
            <SideTag side="AGAINST" size="sm" />
            <span className="min-w-0 truncate text-sm font-semibold text-against-strong">{againstName}</span>
            <span className="ml-auto text-xs text-against-strong">argues it’s false</span>
          </li>
        </ul>
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-xl text-ink">
          <FileText aria-hidden className="size-5" /> Format
        </h3>
        <p className="mt-1 text-sm text-ink-2">{FORMAT_SUMMARY}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Fact label="Category" value={terms.category.name} />
          <Fact label="Each round" value={`${terms.roundDurationHours} hours`} />
          <Fact label="Time to accept" value={`${terms.acceptWindowHours} hours`} />
          <Fact label="Opening limit" value={`${nf.format(terms.limits.openingMaxChars)} characters`} />
          <Fact label="Rebuttal limit" value={`${nf.format(terms.limits.rebuttalMaxChars)} characters`} />
          <Fact label="Evidence links" value={`Up to ${terms.limits.maxLinksPerSubmission} per entry`} />
        </dl>
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-xl text-ink">
          <Gavel aria-hidden className="size-5" /> How it’s judged
        </h3>
        <p className="mt-1 text-sm text-ink-2">{JUDGING_SUMMARY}</p>
        {rubric ? (
          <div className="mt-3 rounded-[var(--radius-sm)] border border-line p-3">
            <p className="text-sm font-semibold text-ink">
              Rubric: {rubric.name}{" "}
              <span className="font-normal text-ink-3">
                ({rubric.id} v{rubric.version})
              </span>
            </p>
            {rubric.description ? <p className="mt-1 text-sm text-ink-2">{rubric.description}</p> : null}
            <ul className="mt-3 flex flex-col gap-2.5">
              {rubric.criteria.map((criterion) => (
                <li key={criterion.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold text-ink">{criterion.label}</span>
                    <span className="tabular font-display text-lg text-ink">{criterion.weight}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="h-full rounded-full bg-ink-2" style={{ width: `${criterion.weight}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-3">{criterion.guidance}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-2 text-sm font-semibold text-warning">The rubric details couldn’t be loaded right now.</p>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-xl text-ink">
          <Scale aria-hidden className="size-5" /> Rules both sides agree to
        </h3>
        <dl className="mt-2 flex flex-col gap-3 text-sm">
          <Rule title="If someone doesn’t show up" text={terms.rulesText.noShow} />
          <Rule title="Deadlines and late entries" text={terms.rulesText.late} />
          <Rule title="Cancelling" text={terms.rulesText.cancellation} />
          <Rule title="Appeals" text={terms.rulesText.appeal} />
        </dl>
      </section>

      {fingerprint ? (
        <p className="text-xs text-ink-3">
          These terms are frozen. Terms fingerprint: <span className="tabular font-semibold text-ink-2">{fingerprint}</span>
        </p>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Rule({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <dt className="font-semibold text-ink">{title}</dt>
      <dd className="text-ink-2">{text}</dd>
    </div>
  );
}
