// Owner: verdict. Appeal section of the verdict page: the right state for whoever is looking.
import Link from "@/shims/next-link";
import { Scale } from "lucide-react";
import { Badge } from "@/components/argue/ui/badge";
import type { VerdictPageData } from "@domain/appeals/queries";
import { APPEAL_STATUS_LABELS, APPEAL_WINDOW_HOURS } from "@domain/appeals/rules";
import type { AppealGround } from "@domain/db/schema";
import { AppealForm } from "./appeal-form";
import { When } from "./verdict-history";

const STATUS_TONE = { open: "warning", upheld: "neutral", reevaluated: "judge", overturned: "success" } as const;

export function AppealPanel({
  data,
  appealDraft = null,
  onAppealDraftDone,
}: {
  data: VerdictPageData;
  /** Agent-drafted appeal for THIS debate (prefill-appeal); `key` remounts the form when a new draft lands. */
  appealDraft?: { key: string; ground: AppealGround; text: string } | null;
  onAppealDraftDone?: () => void;
}) {
  const { viewer, eligibility } = data;
  const own = viewer.side ? data.appeals.find((a) => a.appellantSide === viewer.side) : undefined;

  return (
    <section aria-labelledby="appeal-title" className="rounded-[var(--radius-lg)] border border-line bg-surface p-4 sm:p-5">
      <h2 id="appeal-title" className="flex items-center gap-2 text-3xl text-ink">
        <Scale aria-hidden className="size-6" /> Appeals
      </h2>

      <div className="mt-3" aria-live="polite">
        {own ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">Your appeal: {own.groundLabel}</span>
              <Badge tone={STATUS_TONE[own.status]}>{APPEAL_STATUS_LABELS[own.status]}</Badge>
            </div>
            <When iso={own.createdAt} />
            {own.text ? <blockquote className="border-l-2 border-line-strong pl-3 text-sm text-ink-2">{own.text}</blockquote> : null}
            {own.decisionNote ? (
              <p className="rounded-[var(--radius)] bg-surface-2 p-3 text-sm text-ink">
                <span className="font-semibold">Reviewer&rsquo;s reason: </span>
                {own.decisionNote}
              </p>
            ) : own.status === "open" ? (
              <p className="text-sm text-ink-2">A reviewer who wasn&rsquo;t in this debate will decide. You&rsquo;ll get a notification.</p>
            ) : null}
            <p className="text-xs text-ink-3">Each debater gets one appeal per debate.</p>
          </div>
        ) : viewer.side && eligibility.eligible ? (
          <AppealForm
            key={appealDraft?.key ?? "blank"}
            competitionId={data.competitionId}
            closesAt={eligibility.closesAt}
            draft={appealDraft}
            {...(onAppealDraftDone ? { onDraftDone: onAppealDraftDone } : {})}
          />
        ) : viewer.side && !eligibility.eligible ? (
          <p className="text-sm text-ink-2">{eligibility.message}</p>
        ) : (
          <p className="text-sm text-ink-2">
            Either debater can appeal once, within {APPEAL_WINDOW_HOURS} hours of the verdict, if they think the judge
            made a mistake (not just because they disagree).{" "}
            <Link href="/rules#appeals" className="font-semibold text-ink underline underline-offset-2">
              How appeals work
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
