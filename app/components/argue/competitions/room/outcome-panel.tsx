// Owner: challenges. What happened / what happens next, for phases where nobody needs to write.
import { Ban, Gavel, Hourglass, UserCheck } from "lucide-react";
import { VerdictSummary } from "@/components/argue/verdict/verdict-summary";
import { ButtonLink } from "@/components/argue/ui/button";
import { Card } from "@/components/argue/ui/card";
import type { VerdictSummaryData } from "@domain/appeals/queries";
import type { CompetitionRoomView } from "@domain/competitions/queries";

export function OutcomePanel({
  room,
  verdictSummary,
}: {
  room: CompetitionRoomView;
  /** Loader-fed (reference `getVerdictSummaryData(room.id)`); the compact card is omitted when absent. */
  verdictSummary?: VerdictSummaryData | null;
}) {
  const isParticipant = room.viewer.role !== null;
  const verdictLink = (
    <ButtonLink href={`/c/${room.id}/verdict`} variant="judge" icon={<Gavel aria-hidden className="size-4" />}>
      See the full verdict
    </ButtonLink>
  );

  switch (room.phase) {
    case "locked":
    case "evaluating":
      return (
        <Card tone="judge" role="status" aria-live="polite">
          <p className="flex items-center gap-2 font-display text-2xl text-on-judge">
            <Hourglass aria-hidden className="size-5" /> The AI judge is reviewing
          </p>
          <p className="mt-1 text-sm text-on-judge">
            Entries are locked. The judge reads both sides blind — no names, no profiles, no reactions — twice, with
            the order swapped, and scores them against the rubric. {isParticipant ? "We’ll notify you when the verdict is in." : ""}
          </p>
        </Card>
      );
    case "completed":
    case "under_appeal":
      return (
        <div className="flex flex-col gap-3">
          <VerdictSummary competitionId={room.id} data={verdictSummary} />
          {room.phase === "under_appeal" ? (
            <p role="status" className="text-sm text-ink-2">
              This verdict is under appeal. A human reviewer will uphold it, order a fresh evaluation, or overturn it.
            </p>
          ) : null}
          <div>{verdictLink}</div>
        </div>
      );
    case "needs_review":
      return (
        <Card role="status">
          <p className="flex items-center gap-2 text-2xl text-ink">
            <UserCheck aria-hidden className="size-5" /> Waiting for a human reviewer
          </p>
          <p className="mt-1 text-sm text-ink-2">
            The AI judge couldn’t reach a confident result (or the evaluation failed), so rather than force a winner a
            human will review it.
          </p>
          {room.hasVerdict ? <div className="mt-3">{verdictLink}</div> : null}
        </Card>
      );
    case "cancelled":
    case "declined":
    case "expired":
    case "withdrawn":
      return (
        <Card role="status">
          <p className="flex items-center gap-2 text-2xl text-ink">
            <Ban aria-hidden className="size-5" /> {ENDED_TITLE[room.phase]}
          </p>
          <p className="mt-1 text-sm text-ink-2">{endedDetail(room, isParticipant)}</p>
        </Card>
      );
    default:
      return null;
  }
}

const ENDED_TITLE = {
  cancelled: "Challenge cancelled",
  declined: "Challenge declined",
  expired: "Challenge expired",
  withdrawn: "Challenge withdrawn",
} as const;

function endedDetail(room: CompetitionRoomView, isParticipant: boolean): string {
  switch (room.phase) {
    case "cancelled":
      return `${room.cancelReason ?? "This challenge was cancelled."} No verdict and no rating change.`;
    case "declined":
      return isParticipant && room.declineReason
        ? `@${room.recipient.handle} declined: “${room.declineReason}”`
        : `@${room.recipient.handle} declined this challenge.`;
    case "expired":
      return `@${room.recipient.handle} didn’t reply within ${room.terms.acceptWindowHours} hours.`;
    default:
      return `@${room.challenger.handle} withdrew the challenge before it was accepted.`;
  }
}
