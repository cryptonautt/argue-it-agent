import Link from "@/shims/next-link";
import { Avatar } from "@/components/argue/ui/avatar";
import { Badge } from "@/components/argue/ui/badge";
import { Countdown } from "@/components/argue/ui/countdown";
import { SideTag } from "@/components/argue/ui/side-tag";
import type { DebateParticipant, DebateResult } from "@domain/arguments/search";

/** A live one-on-one debate in Explore: the question, both corners, and the clock. */
export function DebateCard({ debate }: { debate: DebateResult }) {
  const forSide = debate.participants.find((p) => p.side === "FOR");
  const againstSide = debate.participants.find((p) => p.side === "AGAINST");
  return (
    <article className="relative flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface p-4 hover:border-line-strong sm:p-5">
      <header className="flex items-center justify-between gap-2 text-sm">
        <Badge tone="outline">{debate.category.name}</Badge>
        <span className="text-xs font-semibold text-ink-3 uppercase">
          {debate.round === "rebuttal" ? "Rebuttal round" : "Opening round"}
        </span>
      </header>
      <h3 className="font-display text-2xl leading-tight text-ink">
        <Link
          href={`/c/${debate.id}`}
          className="outline-none after:absolute after:inset-0 after:rounded-[var(--radius)] after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-focus"
        >
          {debate.proposition}
        </Link>
      </h3>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Corner participant={forSide} side="FOR" />
        <span aria-hidden className="font-display text-xl font-extrabold text-ink-3 italic">
          VS
        </span>
        <Corner participant={againstSide} side="AGAINST" align="end" />
      </div>
      {debate.deadline ? (
        <Countdown deadline={debate.deadline} label="Round closes in" className="text-sm font-semibold text-ink-2" />
      ) : null}
    </article>
  );
}

function Corner({
  participant,
  side,
  align = "start",
}: {
  participant: DebateParticipant | undefined;
  side: "FOR" | "AGAINST";
  align?: "start" | "end";
}) {
  const name = participant?.displayName ?? "—";
  return (
    <div className={align === "end" ? "flex min-w-0 flex-col items-end gap-1.5" : "flex min-w-0 flex-col items-start gap-1.5"}>
      <SideTag side={side} size="sm" />
      <span className={align === "end" ? "flex min-w-0 flex-row-reverse items-center gap-1.5" : "flex min-w-0 items-center gap-1.5"}>
        <Avatar name={name} src={participant?.avatarUrl} size="xs" />
        <span className="truncate text-sm font-semibold text-ink">{name}</span>
      </span>
    </div>
  );
}
