// Owner: 5b-screens-b (ported from reference src/app/c/[id]/verdict/page.tsx). /c/:id/verdict: the full AI
// verdict, how it was judged, appeals and history. Data: clientLoader → `get-verdict`.
//
// File name: `c.$id_.verdict.tsx` (trailing underscore), not `c.$id.verdict.tsx`. With flatRoutes the latter
// nests under `c.$id.tsx` and would render inside the room page, which has no <Outlet/>. The URL is the same:
// /c/:id/verdict.
import { ArrowLeft, UserCheck } from "lucide-react";
import { useLoaderData, type ClientLoaderFunctionArgs, type MetaFunction } from "react-router";

import { PageContainer } from "@/components/argue/shell/page";
import { ButtonLink } from "@/components/argue/ui/button";
import { Card } from "@/components/argue/ui/card";
import { AppealPanel } from "@/components/argue/verdict/appeal-panel";
import { HowJudged } from "@/components/argue/verdict/how-judged";
import { FlaggedClaims, StrengthsWeaknesses } from "@/components/argue/verdict/insights";
import { OutcomeHero } from "@/components/argue/verdict/outcome-hero";
import { Scorecard } from "@/components/argue/verdict/scorecard";
import { ShareVerdictButton } from "@/components/argue/verdict/share-button";
import { VerdictHistory } from "@/components/argue/verdict/verdict-history";
import { VerdictPending } from "@/components/argue/verdict/verdict-pending";
import Link from "@/shims/next-link";
import type { VerdictPageData } from "@domain/appeals/queries";

import { loadAction, requireUuid } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";
import { findCodeRubric } from "./_lib/screen-data";

export async function clientLoader({ params, request }: ClientLoaderFunctionArgs) {
  const competitionId = requireUuid(params.id);
  const data = await loadAction<VerdictPageData | null>("get-verdict", { competitionId }, request);
  // Reference used `findRubric` (code rubrics, then the `rubrics` table). Code rubrics are the source of
  // truth and are client-safe; an unknown id@version degrades the "How this was judged" panel to null.
  const rubric = data.current ? findCodeRubric(data.rubric.id, data.rubric.version) : null;
  return { data, rubric };
}
clientLoader.hydrate = true as const;

// The SSR shell is anonymous and shared, so the server-rendered title stays generic; the client title is
// filled in once the verdict loads. (Reference OG images/route are not ported.)
export const meta: MetaFunction<typeof clientLoader> = ({ loaderData: loaded }) => {
  const d = loaded?.data;
  return [
    {
      title: d ? `${d.sides.A.displayName} vs ${d.sides.B.displayName}: the AI verdict · ARGUE IT` : "Verdict · ARGUE IT",
    },
  ];
};

export const HydrateFallback = RouteLoading;
export const ErrorBoundary = RouteErrorState;

export default function VerdictPage() {
  const { data, rubric } = useLoaderData<typeof clientLoader>();

  const { current } = data;
  const human = current?.decidedBy === "human";
  const explanation = current?.explanation ?? null;

  return (
    <PageContainer>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/c/${data.competitionId}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to the debate
        </Link>
        {data.argument ? (
          data.argument.removed ? (
            <span className="text-sm text-ink-3">This argument was removed</span>
          ) : (
            <Link href={`/a/${data.argument.id}`} className="max-w-[60%] truncate text-sm text-ink-3 hover:text-ink">
              From: {data.argument.title}
            </Link>
          )
        ) : null}
      </div>

      {!current ? (
        <VerdictPending competitionId={data.competitionId} status={data.status} />
      ) : (
        <div className="flex flex-col gap-8 pb-12">
          <OutcomeHero
            header={data}
            verdict={current}
            underAppeal={data.status === "under_appeal"}
            reevaluating={data.reevaluating}
          />

          {data.status === "needs_review" ? (
            <Card tone="inset" className="flex gap-3" aria-live="polite">
              <UserCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
              <p className="text-sm text-ink">
                A human reviewer who isn&rsquo;t in this debate is checking this result before it&rsquo;s final.
              </p>
            </Card>
          ) : null}

          {human && current.reviewNote ? (
            <Card className="border-l-4 border-l-ink">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Reviewer&rsquo;s reason</p>
              <p className="mt-1 text-ink">{current.reviewNote}</p>
            </Card>
          ) : null}

          {explanation?.summary && !(human && explanation.summary === current.reviewNote) ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                {human ? "The AI's original summary" : "Why"}
              </p>
              <p className="mt-1 text-lg text-ink">{explanation.summary}</p>
              {explanation.method ? (
                <p className="mt-2 text-sm text-ink-3">
                  The judge only ever saw labels: Side A is {data.sides.A.displayName} (FOR), Side B is{" "}
                  {data.sides.B.displayName} (AGAINST). Names typed inside a submission appear as [Side A] / [Side B].
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <ShareVerdictButton
              path={`/c/${data.competitionId}/verdict`}
              title={`${data.sides.A.displayName} vs ${data.sides.B.displayName}`}
            />
            <ButtonLink href={`/c/${data.competitionId}`} variant="secondary">
              Read both sides
            </ButtonLink>
          </div>

          {/*
            AGENT-8 SLOT (Task 10, Verdict Explainer): "Ask why" belongs on EACH criterion row, and those rows are
            rendered inside <Scorecard> (app/components/argue/verdict/scorecard.tsx), not here. Add an optional
            render prop to Scorecard (e.g. `renderCriterionAction?: (criterionKey: string) => ReactNode`) and pass
            it from this call site; the button calls sendToAgentChat with the competition id + criterion key.
          */}
          {current.scores && current.scores.criteria.length > 0 ? (
            <Scorecard
              scores={current.scores}
              explanation={explanation}
              sides={data.sides}
              hiddenQuoteCount={current.hiddenQuoteCount}
              aiScoresOnly={human}
              inconclusive={current.outcome === "inconclusive"}
            />
          ) : null}
          {/* END AGENT-8 SLOT (Ask why) */}

          {explanation && explanation.method ? (
            <>
              <StrengthsWeaknesses explanation={explanation} sides={data.sides} />
              <FlaggedClaims explanation={explanation} sides={data.sides} />
            </>
          ) : null}

          <HowJudged verdict={current} rubric={rubric} rubricRef={data.rubric} />
          {/*
            AGENT-8 SLOT (Task 10, appeal prefill): the appeal form lives in <AppealPanel> → AppealForm. Read
            readClientAppState("appeal-draft") there (or pass it down from here), show "Drafted by the agent: edit
            before you submit", and delete the key on submit/cancel.
          */}
          <AppealPanel data={data} />
          {/* END AGENT-8 SLOT (appeal prefill) */}
          <VerdictHistory history={data.history} appeals={data.appeals} sides={data.sides} />
        </div>
      )}
    </PageContainer>
  );
}
