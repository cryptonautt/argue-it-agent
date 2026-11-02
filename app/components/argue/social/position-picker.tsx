"use client";

import Link from "@/shims/next-link";
import { useOptimistic, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { SplitBar } from "@/components/argue/ui/score-bar";
import { useToast } from "@/components/argue/ui/toast";
import { cn } from "@domain/lib/cn";
import type { PositionSide } from "@domain/db/schema";
import { removePosition, setPosition } from "@/lib/server-actions";
import type { PositionSummary } from "@domain/social/types";
import {
  POSITION_EVENT,
  applyPositionChange,
  describePosition,
  formatCount,
  type PositionEventDetail,
} from "./position-state";

/** open = can pick; signed-out = buttons lead to sign-in; closed/blocked = read-only counts. */
export type PositionPickerMode = "open" | "signed-out" | "closed" | "blocked";

export interface PositionPickerProps {
  initial: PositionSummary;
  mode: PositionPickerMode;
  signInHref: string;
}

const SIDES: ReadonlyArray<{ side: PositionSide; label: string }> = [
  { side: "AGREE", label: "Agree" },
  { side: "AGAINST", label: "Against" },
];

const sideStyles: Record<PositionSide, { idle: string; active: string }> = {
  AGREE: {
    idle: "border-for text-for-strong bg-surface hover:bg-for-soft",
    active: "border-for bg-for text-on-for",
  },
  AGAINST: {
    idle: "border-against text-against-strong bg-surface hover:bg-against-soft",
    active: "border-against bg-against text-on-against",
  },
};

const buttonBase =
  "slant inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius)] border-2 " +
  "font-display text-xl font-bold tracking-wide uppercase transition-colors duration-150 " +
  "disabled:opacity-60 disabled:pointer-events-none";

export function PositionPicker({ initial, mode, signInHref }: PositionPickerProps) {
  const [summary, setSummary] = useState(initial);
  const [optimistic, setOptimistic] = useOptimistic(summary);
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const { error } = useToast();

  function choose(next: PositionSide | null) {
    if (mode !== "open" || optimistic.viewerSide === next) return;
    startTransition(async () => {
      setOptimistic(applyPositionChange(optimistic, next));
      const result = next
        ? await setPosition({ argumentId: initial.argumentId, side: next })
        : await removePosition({ argumentId: initial.argumentId });
      if (!result.ok) {
        error(result.error);
        setAnnouncement(`Your position was not changed. ${result.error}`);
        return;
      }
      setSummary(result.data);
      setAnnouncement(describePosition(result.data));
      window.dispatchEvent(
        new CustomEvent<PositionEventDetail>(POSITION_EVENT, {
          detail: { argumentId: initial.argumentId, side: result.data.viewerSide },
        }),
      );
    });
  }

  const total = optimistic.agree + optimistic.against;

  return (
    <section
      aria-labelledby={`positions-${initial.argumentId}`}
      aria-busy={pending || undefined}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`positions-${initial.argumentId}`} className="text-2xl text-ink">
          Where do you stand?
        </h2>
        <p className="text-xs font-semibold text-ink-3">Free position · not a competition entry</p>
      </div>

      <SplitBar forValue={optimistic.agree} againstValue={optimistic.against} size="lg" showLegend={false} />
      <div className="flex justify-between text-sm font-semibold">
        <span className="text-for-strong">
          <span className="tabular font-display text-2xl">{formatCount(optimistic.agree)}</span> agree
        </span>
        <span className="text-ink-3 tabular self-center text-xs">
          {total === 0 ? "No positions yet" : `${formatCount(total)} ${total === 1 ? "person" : "people"}`}
        </span>
        <span className="text-against-strong">
          against <span className="tabular font-display text-2xl">{formatCount(optimistic.against)}</span>
        </span>
      </div>

      {mode === "closed" || mode === "blocked" ? (
        <p className="text-sm text-ink-3">
          {mode === "closed" ? "This argument is closed to new positions." : "You can't take a position here."}
        </p>
      ) : (
        <div role="group" aria-label="Your free position" className="grid grid-cols-2 gap-3">
          {SIDES.map(({ side, label }) => {
            const active = optimistic.viewerSide === side;
            const classes = cn(buttonBase, active ? sideStyles[side].active : sideStyles[side].idle);
            const content = (
              <span className="unslant inline-flex items-center gap-2">
                {active ? <Check aria-hidden className="size-5" /> : null}
                {label}
              </span>
            );
            return mode === "signed-out" ? (
              <Link key={side} href={signInHref} className={classes}>
                {content}
                <span className="sr-only"> — sign in to take a position</span>
              </Link>
            ) : (
              <button
                key={side}
                type="button"
                aria-pressed={active}
                onClick={() => choose(side)}
                className={classes}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
        <p>
          {optimistic.viewerSide
            ? `You're ${optimistic.viewerSide}. Change or remove it any time.`
            : "Pick a side for free — it's not judged. Want a judged debate? Use Challenge this."}
        </p>
        {mode === "open" && optimistic.viewerSide ? (
          <button
            type="button"
            onClick={() => choose(null)}
            className="-mx-2 inline-flex h-11 items-center rounded-full px-2 font-semibold text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            Remove my position
          </button>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
