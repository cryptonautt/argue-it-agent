import Link from "@/shims/next-link";
import { Swords } from "lucide-react";
import { Badge } from "@/components/argue/ui/badge";
import { ButtonLink } from "@/components/argue/ui/button";
import { EmptyState } from "@/components/argue/ui/empty-state";
import { SideTag } from "@/components/argue/ui/side-tag";
import { DEBATE_RESULT_DISPLAY } from "@domain/profiles/history";
import type { DebateHistoryItem } from "@domain/profiles/queries";
import { formatShortDate } from "./format";

export interface DebateHistoryListProps {
  items: readonly DebateHistoryItem[];
  /** Whose profile this is (for copy). */
  displayName: string;
  isOwnProfile: boolean;
  /** href for the next page, when there is one. */
  nextHref: string | null;
}

export function DebateHistoryList({ items, displayName, isOwnProfile, nextHref }: DebateHistoryListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Swords aria-hidden />}
        title="No debates yet"
        description={
          isOwnProfile
            ? "Find a take you disagree with and hit “Challenge this”. The AI judges the argument, never the person."
            : `${displayName} hasn't taken part in a judged challenge yet.`
        }
        action={isOwnProfile ? <ButtonLink href="/">Find a debate</ButtonLink> : undefined}
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {items.map((item) => {
          const display = DEBATE_RESULT_DISPLAY[item.result];
          const href = display.hasVerdict ? `/c/${item.competitionId}/verdict` : `/c/${item.competitionId}`;
          return (
            <li key={item.competitionId}>
              <Link
                href={href}
                className="group block rounded-[var(--radius)] border border-line bg-surface p-4 transition-colors hover:border-line-strong"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <SideTag side={item.side} size="sm" />
                  <Badge tone={display.tone}>{display.label}</Badge>
                  {item.underAppeal ? <Badge tone="warning">Under appeal</Badge> : null}
                  <span className="ml-auto text-xs text-ink-3">{item.category.name}</span>
                </div>
                <p className="font-semibold text-ink">
                  {item.argumentUnavailable ? (
                    <span className="text-ink-3 italic">This argument was removed</span>
                  ) : (
                    item.proposition
                  )}
                </p>
                <p className="mt-1 text-sm text-ink-2">
                  vs{" "}
                  {item.opponent.deleted ? (
                    <span className="text-ink-3">Deleted user</span>
                  ) : (
                    <span className="font-semibold">
                      {item.opponent.displayName} <span className="font-normal text-ink-3">@{item.opponent.handle}</span>
                    </span>
                  )}
                  <span className="text-ink-3"> · {formatShortDate(item.completedAt ?? item.startedAt)}</span>
                </p>
                <p className="mt-2 text-xs font-semibold text-ink underline-offset-2 group-hover:underline">
                  {display.hasVerdict ? "See the AI verdict →" : "Open the debate →"}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
      {nextHref ? (
        <ButtonLink href={nextHref} variant="secondary" fullWidth scroll={false}>
          Older debates
        </ButtonLink>
      ) : null}
    </div>
  );
}
