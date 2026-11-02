"use client";
// Owner: challenges. Timeline of the debate with a live countdown to the running deadline. The server
// decides when rounds close; when a countdown hits zero we just refresh to fetch the new state.

import { useRouter } from "@/shims/next-navigation";
import { useCallback, useEffect } from "react";
import { Check } from "lucide-react";
import { Countdown } from "@/components/argue/ui/countdown";
import { cn } from "@domain/lib/cn";
import { formatDateTime } from "@domain/lib/time";
import type { CompetitionRoomView } from "@domain/competitions/queries";
import type { CompetitionRound } from "@domain/db/schema";
import type { Phase } from "@domain/competitions/state-machine";
import { DEADLINE_LABEL, LIVE_PHASES } from "../labels";

type StepState = "done" | "current" | "upcoming" | "skipped";

interface TimelineStep {
  key: string;
  title: string;
  detail: string | null;
  state: StepState;
}

const POLL_MS = 30_000;

export function RoomTimeline({
  phase,
  round,
  timeline,
  deadline,
}: {
  phase: Phase;
  round: CompetitionRound | null;
  timeline: CompetitionRoomView["timeline"];
  deadline: string | null;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);

  // Light polling (no websockets in v1): only while something can change without this viewer acting.
  useEffect(() => {
    if (!LIVE_PHASES.includes(phase)) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [phase, router]);

  const steps = buildSteps(phase, round, timeline);
  const deadlineLabel = DEADLINE_LABEL[phase];

  return (
    <section aria-label="Timeline" className="rounded-[var(--radius)] border border-line bg-surface p-4">
      {deadline && deadlineLabel ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <Countdown deadline={deadline} label={deadlineLabel} expiredLabel="Closing now…" onExpire={refresh} className="text-base" />
          <span className="text-xs text-ink-3" suppressHydrationWarning>
            Deadline {formatDateTime(deadline)} (your time)
          </span>
        </div>
      ) : null}
      <ol className="flex flex-col gap-0">
        {steps.map((step, index) => (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                  step.state === "done" && "border-success bg-success text-white dark:text-ink-inverse",
                  step.state === "current" && "border-ink bg-ink text-ink-inverse",
                  step.state === "upcoming" && "border-line-strong text-ink-3",
                  step.state === "skipped" && "border-line text-ink-3 line-through",
                )}
                aria-hidden
              >
                {step.state === "done" ? <Check className="size-3.5" /> : index + 1}
              </span>
              {index < steps.length - 1 ? <span className="w-0.5 flex-1 bg-line" aria-hidden /> : null}
            </div>
            <div className={cn("pb-4", step.state === "skipped" && "opacity-60")}>
              <p className={cn("text-sm font-semibold", step.state === "current" ? "text-ink" : "text-ink-2")}>
                {step.title}
                <span className="sr-only"> ({step.state})</span>
              </p>
              {step.detail ? (
                <p className="text-xs text-ink-3" suppressHydrationWarning>
                  {step.detail}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const at = (iso: string | null, prefix: string): string | null => (iso ? `${prefix} ${formatDateTime(iso)}` : null);

const ORDER: readonly Phase[] = ["pending_acceptance", "opening", "rebuttal", "locked"];

export function buildSteps(
  phase: Phase,
  round: CompetitionRound | null,
  t: CompetitionRoomView["timeline"],
): TimelineStep[] {
  const steps: TimelineStep[] = [{ key: "sent", title: "Challenge sent", detail: at(t.sentAt, "Sent"), state: "done" }];

  if (t.acceptedAt === null) {
    const pending = phase === "pending_acceptance";
    steps.push({
      key: "accept",
      title: pending ? "Waiting for a reply" : "Not accepted",
      detail: at(t.acceptDeadline, "Reply by"),
      state: pending ? "current" : "skipped",
    });
    if (!pending) return steps;
  } else {
    steps.push({ key: "accept", title: "Accepted — terms locked", detail: at(t.acceptedAt, "Accepted"), state: "done" });
  }

  // Which round did a finished debate stop in? Entries frozen at or before the opening close mean the
  // no-show rule ended it in round 1; a cancellation keeps the round it happened in.
  const stoppedIn: CompetitionRound | null =
    t.lockedAt !== null
      ? t.openingClosesAt !== null && t.lockedAt <= t.openingClosesAt
        ? "opening"
        : null
      : phase === "cancelled"
        ? round
        : null;
  const position = ORDER.indexOf(phase);
  const roundState = (index: 1 | 2): StepState => {
    if (position !== -1) return index < position ? "done" : index === position ? "current" : "upcoming";
    if (stoppedIn === "opening") return index === 1 && t.lockedAt !== null ? "done" : "skipped";
    if (stoppedIn === "rebuttal") return index === 1 ? "done" : "skipped";
    return "done";
  };

  steps.push(
    { key: "opening", title: "Round 1 · Openings (sealed)", detail: at(t.openingClosesAt, "Closes"), state: roundState(1) },
    { key: "rebuttal", title: "Round 2 · Rebuttals", detail: at(t.rebuttalClosesAt, "Closes"), state: roundState(2) },
  );

  if (phase === "cancelled") {
    steps.push({ key: "end", title: "Cancelled — no verdict", detail: at(t.cancelledAt, "Cancelled"), state: "done" });
  } else {
    const verdictDone = phase === "completed" || phase === "under_appeal";
    steps.push({
      key: "end",
      title: stoppedIn === "opening" ? "Result: forfeit (no AI judging)" : "AI verdict",
      detail: at(t.completedAt, "Published"),
      state: verdictDone ? "done" : phase === "locked" || phase === "evaluating" || phase === "needs_review" ? "current" : "upcoming",
    });
  }
  return steps;
}
