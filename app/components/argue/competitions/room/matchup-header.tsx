// Owner: challenges. Broadcast-style "tale of the tape": the proposition and the two sides facing off.
import Link from "@/shims/next-link";
import { CheckCircle2, PenLine } from "lucide-react";
import { Avatar } from "@/components/argue/ui/avatar";
import { Badge } from "@/components/argue/ui/badge";
import { SideTag } from "@/components/argue/ui/side-tag";
import { cn } from "@domain/lib/cn";
import type { CompetitionRoomView, RoomParticipantView } from "@domain/competitions/queries";
import { PHASE_LABEL, PHASE_TONE } from "../labels";

export function MatchupHeader({ room }: { room: CompetitionRoomView }) {
  const forSide = room.challenger.side === "FOR" ? room.challenger : room.recipient;
  const againstSide = room.challenger.side === "FOR" ? room.recipient : room.challenger;
  const activeRound = room.phase === "opening" || room.phase === "rebuttal" ? room.phase : null;

  return (
    <header className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
        <Badge tone={PHASE_TONE[room.phase]} aria-live="polite">
          {PHASE_LABEL[room.phase]}
        </Badge>
        <Badge tone="outline">{room.terms.category.name}</Badge>
        <span className="text-xs text-ink-3">Direct challenge · AI judged</span>
      </div>
      <h1 className="px-4 pt-3 font-display text-3xl leading-tight text-ink sm:px-5 sm:text-4xl">
        “{room.terms.proposition}”
      </h1>
      <p className="px-4 pt-1 text-sm text-ink-3 sm:px-5">
        From{" "}
        <Link href={`/a/${room.argument.id}`} className="font-semibold text-ink-2 underline-offset-2 hover:underline">
          {room.argument.status === "removed" ? "an argument that was removed" : room.argument.title}
        </Link>
      </p>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-stretch border-t border-line">
        <Corner participant={forSide} viewerId={room.viewer.userId} activeRound={activeRound} />
        <div className="flex items-center bg-ink px-2 sm:px-3" aria-hidden>
          <span className="slant font-display text-xl font-bold text-ink-inverse sm:text-2xl">
            <span className="unslant">VS</span>
          </span>
        </div>
        <Corner participant={againstSide} viewerId={room.viewer.userId} activeRound={activeRound} align="end" />
      </div>
    </header>
  );
}

function Corner({
  participant,
  viewerId,
  activeRound,
  align = "start",
}: {
  participant: RoomParticipantView;
  viewerId: string | null;
  activeRound: "opening" | "rebuttal" | null;
  align?: "start" | "end";
}) {
  const isFor = participant.side === "FOR";
  const isViewer = participant.userId === viewerId;
  const locked = activeRound ? participant.locked[activeRound] : false;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 p-3 sm:p-4",
        isFor ? "bg-for-soft" : "bg-against-soft",
        align === "end" && "items-end text-right",
      )}
    >
      <SideTag side={participant.side} size="sm" />
      <div className={cn("flex min-w-0 items-center gap-2", align === "end" && "flex-row-reverse")}>
        <Avatar name={participant.displayName} src={participant.avatarUrl} size="sm" />
        <div className="min-w-0">
          <p className={cn("truncate font-semibold", isFor ? "text-for-strong" : "text-against-strong")}>
            {participant.displayName}
            {isViewer ? <span className="font-normal"> (you)</span> : null}
          </p>
          <Link href={`/u/${participant.handle}`} className="block truncate text-xs text-ink-2 hover:underline">
            @{participant.handle}
          </Link>
        </div>
      </div>
      <p className="text-xs text-ink-2">{participant.role === "challenger" ? "Challenger" : "Challenged"}</p>
      {activeRound ? (
        <p className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
          {locked ? (
            <>
              <CheckCircle2 aria-hidden className="size-3.5 text-success" /> Locked in
            </>
          ) : (
            <>
              <PenLine aria-hidden className="size-3.5 text-ink-3" /> Not locked yet
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
