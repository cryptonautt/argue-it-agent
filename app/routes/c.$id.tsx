// Owner: 5b-screens-b (ported from reference src/app/c/[id]/page.tsx). The competition room (design §4.2, §6):
// terms, timeline, sealed openings, rebuttals, accept/decline, lock-in, cancel. Deadlines are enforced on
// load by the server. Data: clientLoader → `get-competition` (see app/routes/_lib/route-data.ts for why
// this is not a server loader).
import { CheckCircle2, EyeOff } from "lucide-react";
import { useLoaderData, type ClientLoaderFunctionArgs, type MetaFunction } from "react-router";

import { AdminCancelButton } from "@/components/argue/competitions/admin-cancel-button";
import { MutualCancelControls } from "@/components/argue/competitions/room/cancel-controls";
import { MatchupHeader } from "@/components/argue/competitions/room/matchup-header";
import { OutcomePanel } from "@/components/argue/competitions/room/outcome-panel";
import { ChallengerWaiting, RecipientDecision } from "@/components/argue/competitions/room/pending-panel";
import { RoomTimeline } from "@/components/argue/competitions/room/room-timeline";
import { SubmissionEditor } from "@/components/argue/competitions/room/submission-editor";
import { SubmissionsBoard } from "@/components/argue/competitions/room/submissions-board";
import { TermsPanel } from "@/components/argue/competitions/terms-panel";
import { PageContainer } from "@/components/argue/shell/page";
import { Card } from "@/components/argue/ui/card";
import type { CompetitionRoomView } from "@domain/competitions/queries";
import { TRANSITIONS, otherRole } from "@domain/competitions/state-machine";
import { roundCharLimit } from "@domain/competitions/terms";

import { loadAction, requireUuid } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";

export async function clientLoader({ params, request }: ClientLoaderFunctionArgs) {
  const competitionId = requireUuid(params.id);
  const room = await loadAction<CompetitionRoomView | null>("get-competition", { id: competitionId }, request);
  return { room };
}
clientLoader.hydrate = true as const;

export const meta: MetaFunction<typeof clientLoader> = ({ loaderData: data }) => [
  { title: data?.room ? `Challenge: ${data.room.argument.title} · ARGUE IT` : "Challenge · ARGUE IT" },
];

export const HydrateFallback = RouteLoading;
export const ErrorBoundary = RouteErrorState;

export default function CompetitionRoomPage() {
  const { room } = useLoaderData<typeof clientLoader>();

  const you = room.viewer.role ? room[room.viewer.role] : null;
  const opponent = room.viewer.role ? room[otherRole(room.viewer.role)] : null;
  const writeBlocked =
    room.viewer.role && !room.viewer.canWrite
      ? "Your account is suspended, so you can’t act on this challenge right now."
      : null;
  const isActive = room.phase === "opening" || room.phase === "rebuttal";
  const isPending = room.phase === "pending_acceptance";
  const terms = (
    <TermsPanel
      terms={room.terms}
      rubric={room.rubric}
      forName={sideName(room, "FOR")}
      againstName={sideName(room, "AGAINST")}
      fingerprint={room.termsFingerprint}
    />
  );

  return (
    <PageContainer wide>
      <div className="mx-auto flex max-w-4xl flex-col gap-5 pb-10">
        <MatchupHeader room={room} />
        <RoomTimeline phase={room.phase} round={room.round} timeline={room.timeline} deadline={room.deadline} />

        {isPending ? (
          <>
            {/* Before anything is accepted, the full terms come first (design §4.2). */}
            <section
              aria-label="Terms and rubric"
              className="rounded-[var(--radius)] border border-line bg-surface p-4 sm:p-5"
            >
              <h2 className="mb-4 text-2xl text-ink">The terms</h2>
              {terms}
            </section>
            <PendingArea room={room} writeBlocked={writeBlocked} />
          </>
        ) : null}
        {isActive ? <ActiveArea room={room} writeBlocked={writeBlocked} /> : null}
        <OutcomePanel room={room} />

        <SubmissionsBoard room={room} />

        {isActive && you && opponent && !writeBlocked ? (
          <MutualCancelControls
            competitionId={room.id}
            youRequested={you.cancelRequested}
            opponentRequested={opponent.cancelRequested}
            opponentHandle={opponent.handle}
          />
        ) : null}

        {!isPending ? (
          <details className="group rounded-[var(--radius)] border border-line bg-surface">
            <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-4 text-lg font-semibold text-ink">
              Terms &amp; rubric
              <span className="text-xs font-normal text-ink-3 group-open:hidden">Show</span>
            </summary>
            <div className="border-t border-line p-4">{terms}</div>
          </details>
        ) : null}

        {room.viewer.isAdmin && TRANSITIONS.admin_cancel.from.includes(room.phase) ? (
          <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
            <span className="text-xs text-ink-3">Admin</span>
            <AdminCancelButton competitionId={room.id} />
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}

function sideName(room: CompetitionRoomView, side: "FOR" | "AGAINST"): string {
  const participant = room.challenger.side === side ? room.challenger : room.recipient;
  return participant.userId === room.viewer.userId ? "You" : `@${participant.handle}`;
}

function PendingArea({ room, writeBlocked }: { room: CompetitionRoomView; writeBlocked: string | null }) {
  if (room.viewer.role === "recipient") {
    return (
      <RecipientDecision
        competitionId={room.id}
        termsHash={room.termsHash}
        challengerHandle={room.challenger.handle}
        yourSide={room.recipient.side}
        disabledReason={writeBlocked}
      />
    );
  }
  if (room.viewer.role === "challenger") {
    return <ChallengerWaiting competitionId={room.id} recipientHandle={room.recipient.handle} />;
  }
  return (
    <Card role="status">
      <p className="text-sm text-ink-2">
        @{room.challenger.handle} has challenged @{room.recipient.handle}. The debate starts if they accept.
      </p>
    </Card>
  );
}

function ActiveArea({ room, writeBlocked }: { room: CompetitionRoomView; writeBlocked: string | null }) {
  const round = room.phase === "rebuttal" ? "rebuttal" : "opening";
  const role = room.viewer.role;

  if (!role) {
    return (
      <Card role="status" className="flex items-start gap-3">
        <EyeOff aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-3" />
        <p className="text-sm text-ink-2">
          {round === "opening"
            ? "Openings are sealed: nobody else — not even the opponent — can read either side’s opening until the round closes."
            : "Openings are revealed below. Rebuttals stay sealed until the round closes."}
        </p>
      </Card>
    );
  }

  const you = room[role];
  const opponent = room[otherRole(role)];
  if (you.locked[round]) {
    return (
      <Card role="status" className="flex items-start gap-3">
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <p className="text-sm text-ink-2">
          Your {round} is locked in.{" "}
          {opponent.locked[round]
            ? "Both sides are in — refreshing…"
            : `Waiting for @${opponent.handle}. The round closes when they lock in or at the deadline.`}
        </p>
      </Card>
    );
  }
  if (writeBlocked) {
    return (
      <Card role="alert">
        <p className="text-sm font-semibold text-danger">{writeBlocked}</p>
      </Card>
    );
  }

  const own = room.submissions[round][role];
  const draft = own.visibility === "visible" ? own : null;
  return (
    <SubmissionEditor
      key={round}
      competitionId={room.id}
      round={round}
      side={you.side}
      maxChars={roundCharLimit(room.terms, round)}
      maxLinks={room.terms.limits.maxLinksPerSubmission}
      initialBody={draft?.body ?? ""}
      initialLinks={draft?.links ?? []}
      savedAt={draft?.updatedAt ?? null}
      opponentLocked={opponent.locked[round]}
    />
  );
}
