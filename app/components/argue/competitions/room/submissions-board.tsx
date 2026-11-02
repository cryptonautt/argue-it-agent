// Owner: challenges. The two rounds, side by side. Sealing was already applied on the server: a sealed
// entry arrives here with no text at all.
import { EyeOff, Link2, Lock, ShieldAlert } from "lucide-react";
import { ReportButton } from "@/components/argue/moderation/report-button";
import { SideTag } from "@/components/argue/ui/side-tag";
import { cn } from "@domain/lib/cn";
import { LINK_REL, displayLink } from "@domain/lib/links";
import { formatDateTime } from "@domain/lib/time";
import type { CompetitionRoomView, RoomParticipantView, RoomSubmissionView } from "@domain/competitions/queries";

const ROUNDS = [
  { key: "opening", title: "Round 1 · Openings" },
  { key: "rebuttal", title: "Round 2 · Rebuttals" },
] as const;

export function SubmissionsBoard({ room }: { room: CompetitionRoomView }) {
  if (room.timeline.acceptedAt === null) return null; // Never started: nothing was ever written.
  // FOR on the left, AGAINST on the right — everywhere.
  const sides = room.challenger.side === "FOR" ? [room.challenger, room.recipient] : [room.recipient, room.challenger];
  const openings = Object.values(room.submissions.opening);
  // The rebuttal round ran iff we're in it, or entries froze after both sides had openings
  // (a forfeit or no-show freezes entries straight from round 1).
  const rebuttalStarted =
    room.round === "rebuttal" ||
    (room.timeline.lockedAt !== null && openings.every((v) => v.visibility !== "empty" && v.visibility !== "sealed"));

  return (
    <section aria-label="Debate entries" className="flex flex-col gap-6">
      {ROUNDS.filter((round) => round.key === "opening" || rebuttalStarted).map((round) => (
        <div key={round.key}>
          <h2 className="mb-3 text-2xl text-ink">{round.title}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {sides.map((participant) => (
              <Entry
                key={participant.userId}
                participant={participant}
                view={room.submissions[round.key][participant.role]}
                isOwn={participant.userId === room.viewer.userId}
                canReport={room.viewer.userId !== null}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function Entry({
  participant,
  view,
  isOwn,
  canReport,
}: {
  participant: RoomParticipantView;
  view: RoomSubmissionView;
  isOwn: boolean;
  canReport: boolean;
}) {
  const isFor = participant.side === "FOR";
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-[var(--radius)] border border-line border-t-4 bg-surface p-4",
        isFor ? "border-t-for" : "border-t-against",
      )}
    >
      <header className="flex items-center gap-2">
        <SideTag side={participant.side} size="sm" />
        <span className="min-w-0 truncate text-sm font-semibold text-ink">
          {isOwn ? "You" : `@${participant.handle}`}
        </span>
        {view.visibility === "visible" && view.lockedAt ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-3">
            <Lock aria-hidden className="size-3" /> Locked {formatDateTime(view.lockedAt, "UTC")} UTC
          </span>
        ) : null}
        {view.visibility === "visible" && !view.lockedAt ? (
          <span className="ml-auto text-xs font-semibold text-warning">Draft — only you can see it</span>
        ) : null}
      </header>
      <EntryBody view={view} isOwn={isOwn} />
      {view.visibility === "visible" && !isOwn && canReport ? (
        <div className="flex justify-end">
          <ReportButton targetType="submission" targetId={view.id} />
        </div>
      ) : null}
    </article>
  );
}

function EntryBody({ view, isOwn }: { view: RoomSubmissionView; isOwn: boolean }) {
  switch (view.visibility) {
    case "sealed":
      return (
        <p className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-surface-2 px-3 py-6 text-sm text-ink-2">
          <EyeOff aria-hidden className="size-4 shrink-0" />
          Sealed until the round closes. Neither side can see the other’s entry yet.
        </p>
      );
    case "empty":
      return <p className="text-sm text-ink-3 italic">{isOwn ? "You didn’t submit an entry." : "No entry submitted."}</p>;
    case "moderated":
      return (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <ShieldAlert aria-hidden className="size-4" /> Hidden by moderators. This doesn’t change judging.
        </p>
      );
    case "visible":
      return (
        <>
          {view.moderated ? (
            <p className="text-xs font-semibold text-warning">Hidden from others by moderators. Judging is unaffected.</p>
          ) : null}
          <p className="text-[0.95rem] leading-relaxed whitespace-pre-wrap text-ink">{view.body}</p>
          {view.links.length > 0 ? (
            <ul className="flex flex-col gap-1 border-t border-line pt-2">
              {view.links.map((href) => (
                <li key={href} className="flex min-w-0 items-center gap-1.5 text-sm">
                  <Link2 aria-hidden className="size-3.5 shrink-0 text-ink-3" />
                  <a href={href} rel={LINK_REL} target="_blank" className="truncate text-for-strong underline-offset-2 hover:underline">
                    {displayLink(href)}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      );
  }
}
