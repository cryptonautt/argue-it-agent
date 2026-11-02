// Owner: verdict. Timeline of every verdict version and appeal — nothing is silently replaced.
import { History } from "lucide-react";
import { Badge } from "@/components/argue/ui/badge";
import { formatDateTime, formatRelative } from "@domain/lib/time";
import type { AppealRecord, VerdictRecord } from "@domain/appeals/queries";
import { APPEAL_STATUS_LABELS } from "@domain/appeals/rules";
import { verdictSource, type SidePair } from "@domain/appeals/verdict-view";

interface TimelineEvent {
  key: string;
  at: string;
  title: string;
  badge?: { label: string; tone: "neutral" | "judge" | "warning" | "success" | "outline" };
  body?: string | null;
  quote?: string | null;
}

export function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={`${formatDateTime(iso, "UTC")} UTC`} className="text-xs text-ink-3">
      {formatRelative(iso)}
    </time>
  );
}

export function buildTimeline(history: readonly VerdictRecord[], appeals: readonly AppealRecord[], sides: SidePair): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const v of history) {
    events.push({
      key: `v-${v.id}`,
      at: v.createdAt,
      title: `Verdict v${v.version}: ${v.outcomeView.headline}`,
      badge: v.isCurrent
        ? { label: "Current", tone: "judge" }
        : { label: verdictSource(v.outcome, v.decidedBy), tone: "outline" },
      body: v.decidedBy === "human" ? (v.reviewNote ? `Reviewer: ${v.reviewNote}` : "Decided by a human reviewer.") : null,
    });
  }
  for (const a of appeals) {
    const name = sides[a.appellantSide].displayName;
    events.push({
      key: `a-${a.id}`,
      at: a.createdAt,
      title: `${name} appealed: ${a.groundLabel}`,
      badge: a.status === "open" ? { label: "Under review", tone: "warning" } : undefined,
      quote: a.text,
    });
    if (a.decidedAt && a.status !== "open") {
      events.push({
        key: `d-${a.id}`,
        at: a.decidedAt,
        title: `Appeal ${APPEAL_STATUS_LABELS[a.status].toLowerCase()}`,
        body: a.decisionNote ? `Reviewer: ${a.decisionNote}` : null,
      });
    }
  }
  return events.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
}

export function VerdictHistory({
  history,
  appeals,
  sides,
}: {
  history: readonly VerdictRecord[];
  appeals: readonly AppealRecord[];
  sides: SidePair;
}) {
  if (history.length <= 1 && appeals.length === 0) return null;
  const events = buildTimeline(history, appeals, sides);
  return (
    <section aria-labelledby="history-title">
      <h2 id="history-title" className="flex items-center gap-2 text-3xl text-ink">
        <History aria-hidden className="size-6" /> Verdict history
      </h2>
      <ol className="mt-4 flex flex-col gap-0 border-l-2 border-line pl-5">
        {events.map((event) => (
          <li key={event.key} className="relative pb-5 last:pb-0">
            <span aria-hidden className="absolute top-1.5 -left-[1.6rem] size-3 rounded-full border-2 border-surface bg-ink-3" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{event.title}</span>
              {event.badge ? <Badge tone={event.badge.tone}>{event.badge.label}</Badge> : null}
            </div>
            <When iso={event.at} />
            {event.body ? <p className="mt-1 text-sm text-ink-2">{event.body}</p> : null}
            {event.quote ? (
              <blockquote className="mt-1 border-l-2 border-line-strong pl-3 text-sm text-ink-2">{event.quote}</blockquote>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
