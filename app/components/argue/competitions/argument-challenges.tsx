// Owner: challenges. Active and past direct challenges started from an argument (design §6 /a/[id]).
// Async Server Component: reads the DB itself; callers pass only the argument id.
import Link from "@/shims/next-link";
import { ChevronRight, Swords } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/argue/ui/badge";
import { Countdown } from "@/components/argue/ui/countdown";
import { SideTag } from "@/components/argue/ui/side-tag";
import { formatRelative } from "@domain/lib/time";
import { listArgumentChallenges, type ChallengeListItem } from "@domain/competitions/queries";
import { DEADLINE_LABEL, PHASE_LABEL, PHASE_TONE } from "./labels";

export interface ArgumentChallengesProps {
  argumentId: string;
}

const uuid = z.uuid();

/** Active and past challenges started from this argument. */
export async function ArgumentChallenges({ argumentId }: ArgumentChallengesProps) {
  const items = uuid.safeParse(argumentId).success ? await listArgumentChallenges(argumentId) : [];
  return (
    <section aria-label="Challenges on this argument" className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-2xl text-ink">
        <Swords aria-hidden className="size-5" /> Direct challenges
        {items.length > 0 ? <Badge tone="neutral">{items.length}</Badge> : null}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-3">
          No challenges yet. Disagree strongly? Challenge someone to a one-on-one debate judged by AI.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <ChallengeRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChallengeRow({ item }: { item: ChallengeListItem }) {
  const forSide = item.challenger.side === "FOR" ? item.challenger : item.recipient;
  const againstSide = item.challenger.side === "FOR" ? item.recipient : item.challenger;
  const deadlineLabel = DEADLINE_LABEL[item.phase];
  return (
    <Link
      href={`/c/${item.id}`}
      className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface p-3 hover:border-line-strong"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <SideTag side="FOR" size="sm" />
          <span className="min-w-0 truncate font-semibold text-ink">@{forSide.handle}</span>
          <span className="text-xs font-bold text-ink-3">vs</span>
          <SideTag side="AGAINST" size="sm" />
          <span className="min-w-0 truncate font-semibold text-ink">@{againstSide.handle}</span>
        </div>
        <p className="line-clamp-2 text-sm text-ink-2">{item.proposition}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={PHASE_TONE[item.phase]}>{PHASE_LABEL[item.phase]}</Badge>
          {item.deadline && deadlineLabel ? (
            <Countdown deadline={item.deadline} label={deadlineLabel} className="text-xs" />
          ) : (
            <span className="text-xs text-ink-3" suppressHydrationWarning>
              {formatRelative(item.completedAt ?? item.sentAt)}
            </span>
          )}
        </div>
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-3" />
    </Link>
  );
}
