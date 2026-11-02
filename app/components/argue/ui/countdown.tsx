"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { cn } from "@domain/lib/cn";
import { HOUR_MS, formatCountdown, formatDateTime, toDate } from "@domain/lib/time";

export interface CountdownProps {
  /** Deadline as ISO string, epoch ms or Date (server timestamp). */
  deadline: string | number | Date;
  /** Prefix, e.g. "Openings close in". */
  label?: string;
  /** Shown once the deadline passes (default "Closed"). The server still decides — refresh to see the new state. */
  expiredLabel?: string;
  /** Called once when the countdown reaches zero (e.g. router.refresh()). */
  onExpire?: () => void;
  className?: string;
}

/**
 * Live countdown to a server deadline. Ticks every second in the final hour, every 30s before that.
 * Display only: deadlines are enforced on the server.
 */
export function Countdown({ deadline, label, expiredLabel = "Closed", onExpire, className }: CountdownProps) {
  const target = toDate(deadline).getTime();
  const [remaining, setRemaining] = useState(() => target - Date.now());

  useEffect(() => {
    let expired = false;
    const tick = () => {
      const ms = target - Date.now();
      setRemaining(ms);
      if (ms <= 0 && !expired) {
        expired = true;
        onExpire?.();
      }
      return ms;
    };
    let timer: number;
    const schedule = () => {
      const ms = tick();
      if (ms <= 0) return;
      timer = window.setTimeout(schedule, ms <= HOUR_MS ? 1_000 : 30_000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [target, onExpire]);

  const isExpired = remaining <= 0;
  const urgent = !isExpired && remaining <= HOUR_MS;

  return (
    <span
      role="timer"
      aria-live="off"
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-semibold",
        isExpired ? "text-ink-3" : urgent ? "text-warning" : "text-ink-2",
        className,
      )}
    >
      <Timer aria-hidden className="size-4" />
      <span suppressHydrationWarning>
        {isExpired ? expiredLabel : `${label ? `${label} ` : ""}`}
        {!isExpired ? <span className="tabular">{formatCountdown(remaining)}</span> : null}
      </span>
      <time dateTime={new Date(target).toISOString()} className="sr-only" suppressHydrationWarning>
        {formatDateTime(target)}
      </time>
    </span>
  );
}
