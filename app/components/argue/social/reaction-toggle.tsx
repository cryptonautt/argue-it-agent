"use client";

import Link from "@/shims/next-link";
import { useOptimistic, useState, useTransition } from "react";
import { Flame } from "lucide-react";
import { useToast } from "@/components/argue/ui/toast";
import { cn } from "@domain/lib/cn";
import type { ReactionTarget } from "@domain/db/schema";
import { setReaction } from "@/lib/server-actions";

/** open = can react; signed-out = link to sign-in; own/disabled = count only. */
export type ReactionMode = "open" | "signed-out" | "own" | "disabled";

export interface ReactionToggleProps {
  targetType: ReactionTarget;
  targetId: string;
  initialCount: number;
  initialReacted: boolean;
  mode: ReactionMode;
  signInHref?: string;
}

interface ReactionState {
  count: number;
  reacted: boolean;
}

const nf = new Intl.NumberFormat("en-GB", { notation: "compact" });

const chip =
  "inline-flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors";

/** One-tap "fire" reaction with optimistic count. Community signal only — never judged, never rated. */
export function ReactionToggle({
  targetType,
  targetId,
  initialCount,
  initialReacted,
  mode,
  signInHref = "/sign-in",
}: ReactionToggleProps) {
  const [state, setState] = useState<ReactionState>({ count: initialCount, reacted: initialReacted });
  const [optimistic, setOptimistic] = useOptimistic(state);
  const [, startTransition] = useTransition();
  const { error } = useToast();

  const label = `Fire reaction, ${optimistic.count}`;
  const content = (
    <>
      <Flame aria-hidden className={cn("size-4", optimistic.reacted && "fill-current")} />
      <span className="tabular">{optimistic.count > 0 ? nf.format(optimistic.count) : ""}</span>
    </>
  );

  if (mode === "signed-out") {
    return (
      <Link href={signInHref} className={cn(chip, "text-ink-2 hover:bg-surface-2 hover:text-ink")} aria-label={`${label}. Sign in to react`}>
        {content}
      </Link>
    );
  }
  if (mode !== "open") {
    return (
      <span className={cn(chip, "text-ink-3")} aria-label={label}>
        {content}
      </span>
    );
  }

  function toggle() {
    const next = !optimistic.reacted;
    startTransition(async () => {
      setOptimistic({ reacted: next, count: Math.max(0, optimistic.count + (next ? 1 : -1)) });
      const result = await setReaction({ targetType, targetId, active: next });
      if (!result.ok) {
        error(result.error);
        return;
      }
      setState({ count: result.data.count, reacted: result.data.viewerReacted });
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={optimistic.reacted}
      aria-label={label}
      className={cn(
        chip,
        optimistic.reacted ? "bg-ink text-ink-inverse hover:bg-ink-2" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      {content}
    </button>
  );
}
