// Owner: 5b-screens-b. /admin/review: ONE moderator queue with two tabs, merging the reference
// /admin/review (inconclusive or failed evaluations) and /admin/appeals (open + recently decided appeals).
// Tab in the URL: /admin/review?tab=review (default) | ?tab=appeals.
//
// Access: the `list-review-queue` action authorizes moderators. A non-staff user gets FORBIDDEN, which this
// screen renders as "staff only" with NO case material (loadStaffAction never returns data on FORBIDDEN).
// Decision actions re-check the role on the server.
import { Scale, ShieldAlert, UserCheck } from "lucide-react";
import {
  useLoaderData,
  useLocation,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import { AgentDraftSlot, TriageQueueButton } from "@/components/argue/moderation/draft-card";
import { PageContainer } from "@/components/argue/shell/page";
import { Badge } from "@/components/argue/ui/badge";
import { ButtonLink } from "@/components/argue/ui/button";
import { Card } from "@/components/argue/ui/card";
import { EmptyState } from "@/components/argue/ui/empty-state";
import { LinkTabs } from "@/components/argue/ui/link-tabs";
import {
  BLIND_SIDE,
  CaseHeading,
  Identities,
  SubmissionsBlind,
  VerdictBrief,
} from "@/components/argue/verdict/admin/blind";
import {
  AppealDecisionForm,
  RetryEvaluationButton,
  ReviewDecisionForm,
} from "@/components/argue/verdict/admin/decision-forms";
import { PassCompare } from "@/components/argue/verdict/admin/pass-compare";
import { When } from "@/components/argue/verdict/verdict-history";
import Link from "@/shims/next-link";
import type { AppealQueue, ReviewQueueItem } from "@domain/appeals/queries";
import { APPEAL_STATUS_LABELS } from "@domain/appeals/rules";

import { loadStaffAction } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";
import { isOwnCase, normaliseReviewQueue, queueTab, type QueueTab } from "./_lib/screen-data";

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  const result = await loadStaffAction<unknown>("list-review-queue", {}, request);
  if (!result.ok) return { forbidden: result.forbidden, queue: null };
  return { forbidden: null, queue: normaliseReviewQueue(result.data) };
}
clientLoader.hydrate = true as const;

/** Switching tabs only changes what is shown; both queues are already loaded. Agent writes still revalidate. */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) {
    const a = new URLSearchParams(currentUrl.search);
    const b = new URLSearchParams(nextUrl.search);
    a.delete("tab");
    b.delete("tab");
    if (a.toString() === b.toString()) return false;
  }
  return defaultShouldRevalidate;
}

export const meta: MetaFunction = () => [{ title: "Review queue · Admin · ARGUE IT" }];

export const HydrateFallback = RouteLoading;
export const ErrorBoundary = RouteErrorState;

export default function AdminReviewPage() {
  const { forbidden, queue } = useLoaderData<typeof clientLoader>();
  const tab: QueueTab = queueTab(useLocation().search);

  if (!queue) {
    return (
      <PageContainer>
        <EmptyState
          icon={<ShieldAlert aria-hidden />}
          title="Staff only"
          description={forbidden ?? "Only moderators can open the review queue."}
          action={<ButtonLink href="/">Back to the feed</ButtonLink>}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer wide>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-display text-3xl text-ink">Admin</p>
        {/*
          AGENT-7 SLOT (Task 8): queue-level "Triage queue" button goes here. It calls
          sendToAgentChat({ message: "Triage the review queue", submit: true, openSidebar: true }).
        */}
        <TriageQueueButton />
        {/* END AGENT-7 SLOT (Triage queue) */}
      </div>
      <LinkTabs
        ariaLabel="Review queue"
        activeKey={tab}
        items={[
          { key: "review", label: "Needs review", href: "/admin/review?tab=review", count: queue.review.length },
          { key: "appeals", label: "Appeals", href: "/admin/review?tab=appeals", count: queue.appeals.open.length },
        ]}
      />
      <div className="pt-6">
        {tab === "appeals" ? (
          <AppealsTab queue={queue.appeals} viewerId={queue.viewerId} />
        ) : (
          <ReviewTab items={queue.review} viewerId={queue.viewerId} />
        )}
      </div>
    </PageContainer>
  );
}

function OwnCaseNote() {
  return (
    <p className="rounded-[var(--radius)] bg-surface-2 p-3 text-sm text-ink">
      You took part in this debate, so another reviewer has to decide it.
    </p>
  );
}

function ReviewTab({ items, viewerId }: { items: ReviewQueueItem[]; viewerId: string | null }) {
  return (
    <div className="flex flex-col gap-6 pb-12">
      <div>
        <h1 className="flex items-center gap-2 text-4xl text-ink">
          Needs review <Badge tone={items.length > 0 ? "warning" : "neutral"}>{items.length}</Badge>
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          These debates have no confident result: the judging passes disagreed or weren&rsquo;t confident, or the
          evaluation failed. Confirm &ldquo;inconclusive&rdquo; unless one side clearly won under the rubric. Sides are
          blind; you can&rsquo;t review a debate you took part in.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<UserCheck />}
          title="Nothing to review"
          description="Inconclusive and failed evaluations land here."
        />
      ) : (
        items.map((item) => {
          const latest = item.runs[0];
          const failed = !latest || latest.status === "failed";
          const isOwn = isOwnCase(item.header, viewerId);
          return (
            <Card key={item.header.competitionId} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <CaseHeading header={item.header} />
                <div className="flex items-center gap-2">
                  <Badge tone={failed ? "danger" : "warning"}>{failed ? "Evaluation failed" : "Inconclusive"}</Badge>
                  <Link
                    href={`/c/${item.header.competitionId}`}
                    className="text-sm font-semibold text-ink underline underline-offset-2"
                  >
                    Debate room
                  </Link>
                </div>
              </div>

              {item.lastJobError && failed ? (
                <p className="break-words rounded-[var(--radius)] bg-danger-soft p-3 text-sm text-ink">
                  Last error: {item.lastJobError}
                </p>
              ) : null}
              {item.current ? <VerdictBrief verdict={item.current} /> : null}

              <div>
                <h2 className="mb-2 text-xl text-ink">Judging passes</h2>
                <PassCompare runs={item.runs} />
              </div>

              <SubmissionsBlind submissions={item.submissions} />
              <Identities header={item.header} />

              {isOwn ? (
                <OwnCaseNote />
              ) : (
                <>
                  {/*
                    AGENT-7 SLOT (Task 8): per-item "Draft with agent" button + <DraftCard> for
                    kind="review", targetId={item.header.competitionId}. Show the case title on the card.
                  */}
                  <AgentDraftSlot
                    kind="review"
                    targetId={item.header.competitionId}
                    title={item.header.proposition}
                  />
                  {/* END AGENT-7 SLOT (review item) */}
                  {item.canRetry ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-dashed border-line-strong p-3">
                      <p className="flex-1 text-sm text-ink-2">
                        The AI never produced a result. If it was a temporary outage, you can run the evaluation again
                        instead of deciding yourself.
                      </p>
                      <RetryEvaluationButton competitionId={item.header.competitionId} />
                    </div>
                  ) : null}
                  <ReviewDecisionForm competitionId={item.header.competitionId} />
                </>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}

function AppealsTab({ queue, viewerId }: { queue: AppealQueue; viewerId: string | null }) {
  return (
    <div className="flex flex-col gap-8 pb-12">
      <div>
        <h1 className="text-4xl text-ink">Appeals</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          Decide each appeal on its ground only. Disagreeing with the result is not a ground. Sides are shown blind;
          you can&rsquo;t decide a debate you took part in. Every decision is audited and both debaters see your reason.
        </p>
      </div>

      <section aria-labelledby="open-appeals" className="flex flex-col gap-4">
        <h2 id="open-appeals" className="flex items-center gap-2 text-2xl text-ink">
          Open <Badge tone={queue.open.length > 0 ? "warning" : "neutral"}>{queue.open.length}</Badge>
        </h2>
        {queue.open.length === 0 ? (
          <EmptyState
            icon={<Scale />}
            title="No open appeals"
            description="New appeals appear here as soon as they're filed."
          />
        ) : (
          queue.open.map((item) => {
            const isOwn = isOwnCase(item.header, viewerId);
            const blocked =
              item.current?.outcome === "forfeit"
                ? "Not available for forfeits (nothing was judged)."
                : item.reevaluationUsed
                  ? "Already used once for this debate."
                  : null;
            return (
              <Card key={item.appeal.id} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <CaseHeading header={item.header} />
                  <Link
                    href={`/c/${item.header.competitionId}/verdict`}
                    className="text-sm font-semibold text-ink underline underline-offset-2"
                  >
                    Public verdict page
                  </Link>
                </div>

                <div className="rounded-[var(--radius)] border-l-4 border-l-warning bg-warning-soft p-3">
                  <p className="text-sm font-semibold text-ink">
                    {BLIND_SIDE[item.appeal.appellantSide]} appeals: {item.appeal.groundLabel}
                  </p>
                  <When iso={item.appeal.createdAt} />
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{item.appeal.text}</p>
                </div>

                {item.current ? (
                  <VerdictBrief verdict={item.current} />
                ) : (
                  <p className="text-sm text-danger">No current verdict found.</p>
                )}
                <SubmissionsBlind submissions={item.submissions} />
                <Identities header={item.header} />

                {isOwn ? (
                  <OwnCaseNote />
                ) : (
                  <>
                    {/*
                      AGENT-7 SLOT (Task 8): per-item "Draft with agent" button + <DraftCard> for
                      kind="appeal", targetId={item.appeal.id}. Show the case title on the card.
                    */}
                    <AgentDraftSlot kind="appeal" targetId={item.appeal.id} title={item.header.proposition} />
                    {/* END AGENT-7 SLOT (appeal item) */}
                    <AppealDecisionForm
                      appealId={item.appeal.id}
                      competitionId={item.header.competitionId}
                      currentOutcome={item.current?.outcome ?? null}
                      reevaluationBlockedReason={blocked}
                    />
                  </>
                )}
              </Card>
            );
          })
        )}
      </section>

      <section aria-labelledby="recent-appeals" className="flex flex-col gap-3">
        <h2 id="recent-appeals" className="text-2xl text-ink">
          Recently decided
        </h2>
        {queue.recent.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing decided yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-[var(--radius)] border border-line bg-surface">
            {queue.recent.map(({ appeal, header }) => (
              <li key={appeal.id} className="flex flex-col gap-1 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/c/${header.competitionId}/verdict`}
                    className="min-w-0 truncate font-semibold text-ink hover:underline"
                  >
                    {header.proposition}
                  </Link>
                  <Badge tone="outline">{APPEAL_STATUS_LABELS[appeal.status]}</Badge>
                </div>
                <p className="text-ink-2">
                  {BLIND_SIDE[appeal.appellantSide]} &middot; {appeal.groundLabel}
                  {appeal.decidedAt ? (
                    <>
                      {" "}
                      &middot; <When iso={appeal.decidedAt} />
                    </>
                  ) : null}
                </p>
                {appeal.decisionNote ? <p className="text-ink-3">Reason: {appeal.decisionNote}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
