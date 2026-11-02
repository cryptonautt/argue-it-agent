// Owner: verdict. Confidence shown as words + a 3-step meter (never a bare percentage — false precision).
import { cn } from "@domain/lib/cn";
import type { ConfidenceLabel } from "@domain/db/json-types";
import { CONFIDENCE_COPY } from "@domain/appeals/verdict-view";

const STEPS: Record<ConfidenceLabel, number> = { low: 1, medium: 2, high: 3 };

export function ConfidenceMeter({
  label,
  showDescription = false,
  className,
}: {
  label: ConfidenceLabel;
  showDescription?: boolean;
  className?: string;
}) {
  const copy = CONFIDENCE_COPY[label];
  const filled = STEPS[label];
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden className="inline-flex items-end gap-0.5">
          {[1, 2, 3].map((step) => (
            <span
              key={step}
              className={cn("w-1.5 rounded-sm", step <= filled ? "bg-ink" : "bg-line-strong")}
              style={{ height: `${6 + step * 4}px` }}
            />
          ))}
        </span>
        Confidence: {copy.label}
      </span>
      {showDescription ? <span className="text-sm text-ink-2">{copy.description}</span> : null}
    </div>
  );
}
